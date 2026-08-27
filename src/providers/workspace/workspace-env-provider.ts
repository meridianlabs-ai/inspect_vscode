import { existsSync, statSync } from "fs";
import { join } from "path";

import { isEqual } from "lodash";
import {
  Disposable,
  Event,
  EventEmitter,
  ExtensionContext,
  MessageItem,
  Uri,
  window,
} from "vscode";

import { Command } from "../../core/command";
import { clearEnv, envFilePathIsSafe, readEnv, writeEnv } from "../../core/env";
import { log } from "../../core/log";
import {
  toAbsolutePath,
  workspacePath,
  workspaceRelativePath,
} from "../../core/path";
import { isUri } from "../../core/uri";
import { activeWorkspaceFolder } from "../../core/workspace";
import { kInspectEnvValues } from "../inspect/inspect-constants";
import { kScoutEnvValues } from "../scout/scout-constants";

import { workspaceEnvCommands } from "./workspace-env-commands";

export function activateWorkspaceEnv(
  context: ExtensionContext
): [Command[], WorkspaceEnvManager] {
  // Monitor changes to the file
  const envManager = new WorkspaceEnvManager(context);
  return [workspaceEnvCommands(), envManager];
}

// workspaceState key for remote log/scan-results locations the user has approved
// for this workspace. Keyed by the raw .env value string.
const kApprovedRemoteEnvKey = "inspect.approvedRemoteEnvDirs";

// Remote storage schemes Inspect actually supports as a log/scan-results
// backend (its fsspec configuration). Only these are honored from the workspace
// .env — and only after approval, since they carry credential/scope-root risk.
// Any other scheme (http/https and anything unrecognized) is not a real backend
// and is ignored outright, so it is never handed to the view server: this
// removes the SSRF vector (e.g. a repo-shipped http://169.254.169.254/ metadata
// URL) structurally rather than relying on a prompt.
const kApprovableRemoteSchemes = new Set([
  "s3",
  "gs",
  "gcs",
  "az",
  "abfs",
  "abfss",
  "hf",
]);

// Fired when the active task changes
export interface EnvironmentChangedEvent {
  mtime: number;
}

// Manages the workspace environment
export class WorkspaceEnvManager implements Disposable {
  constructor(private readonly context_: ExtensionContext) {
    const envUri = this.getEnvUri();
    this.env = this.isEnvFileSafe(envUri) ? readEnv(envUri) : {};
    this.lastUpdated_ = Date.now();
    const envRelativePath = workspaceRelativePath(
      toAbsolutePath(envUri.fsPath)
    );
    log.appendLine(`Watching ${envRelativePath}`);
    this.envWatcher_ = setInterval(() => {
      if (existsSync(envUri.fsPath) && this.isEnvFileSafe(envUri)) {
        const envUpdated = statSync(envUri.fsPath).mtime.getTime();
        if (envUpdated > this.lastUpdated_) {
          this.lastUpdated_ = envUpdated;
          const newEnv = readEnv(envUri);
          if (!isEqual(this.env, newEnv)) {
            log.appendLine(`${envRelativePath} changed`);
            this.env = newEnv;
            this.onEnvironmentChanged_.fire({ mtime: envUpdated });
          }
        }
      }
    }, 1000);
  }
  private envWatcher_: NodeJS.Timeout;
  private lastUpdated_: number;
  private env: Record<string, string> = {};

  public getValues(): Record<string, string> {
    return this.env;
  }

  private getEnvUri() {
    const workspaceFolder = activeWorkspaceFolder();
    return Uri.joinPath(workspaceFolder?.uri, ".env");
  }

  // Refuse to read/write .env if it is a symlink or resolves outside the
  // workspace, so a repository-shipped symlink can't redirect the extension's
  // env reads/writes to an arbitrary user file. See CWE-59.
  private isEnvFileSafe(envUri: Uri): boolean {
    const workspaceFolder = activeWorkspaceFolder();
    if (!workspaceFolder) {
      return false;
    }
    const safe = envFilePathIsSafe(envUri.fsPath, workspaceFolder.uri.fsPath);
    if (!safe) {
      log.appendLine(
        `Refusing to use .env: it is a symlink or resolves outside the workspace.`
      );
    }
    return safe;
  }

  public setValues(env: Record<string, string>) {
    const envUri = this.getEnvUri();
    if (!this.isEnvFileSafe(envUri)) {
      return;
    }
    const keys = Object.keys(env);
    keys.forEach((key) => {
      const value = env[key] ?? "";
      if (value === "") {
        // Only actually clear the value if it has changed
        if (this.env[key] && this.env[key] !== value) {
          delete this.env[key];
          clearEnv(key, envUri);
        }
      } else {
        // Only actually change the value if it has changed
        if (this.env[key] !== value) {
          this.env[key] = value;
          writeEnv(key, value, envUri);
        }
      }
    });
  }

  public getDefaultLogDir() {
    return this.resolveEnvDir(
      this.getValues()[kInspectEnvValues.logDir] ?? "",
      "logs"
    );
  }

  public getDefaultScanResultsDir() {
    return this.resolveEnvDir(
      this.getValues()[kScoutEnvValues.scanResults] ?? "",
      "scans"
    );
  }

  // Resolve a log/scan-results location from the (untrusted) workspace .env.
  // Local paths and file:// URIs are used directly; a remote scheme (s3, https,
  // http, gs, ...) is only honored after explicit, remembered user approval for
  // this workspace, because it is both a fetch target for the view server (SSRF
  // / credential exposure) and the log-view webview's scope root. Until
  // approved, fall back to the local default so no request is made to the
  // attacker-chosen host and it never becomes the scope root. See CWE-918.
  private resolveEnvDir(value: string, defaultSubdir: string): Uri {
    const localDefault = () =>
      Uri.file(
        value
          ? workspacePath(value).path
          : join(workspacePath().path, defaultSubdir)
      );

    // Bare/relative paths (and Windows drive paths) are not URIs → local.
    if (!value || !isUri(value)) {
      return localDefault();
    }
    let uri: Uri;
    try {
      uri = Uri.parse(value, true);
    } catch {
      return localDefault();
    }
    if (uri.scheme === "file") {
      return uri;
    }
    // Unsupported scheme (http/https/unknown): not a real Inspect backend, and
    // a fetch target we must never hand to the view server. Ignore it.
    if (!kApprovableRemoteSchemes.has(uri.scheme)) {
      log.appendLine(
        `Ignoring .env location with unsupported scheme "${uri.scheme}:" (${value}); using the local default.`
      );
      return localDefault();
    }
    // Supported remote storage scheme: require one-time approval.
    if (this.getApprovedRemoteDirs().includes(value)) {
      return uri;
    }
    void this.promptApproveRemoteDir(value);
    return localDefault();
  }

  private getApprovedRemoteDirs(): string[] {
    return this.context_.workspaceState.get<string[]>(
      kApprovedRemoteEnvKey,
      []
    );
  }

  private pendingRemotePrompts_ = new Set<string>();

  private async promptApproveRemoteDir(value: string): Promise<void> {
    if (this.pendingRemotePrompts_.has(value)) {
      return;
    }
    this.pendingRemotePrompts_.add(value);
    try {
      const approve: MessageItem = { title: "Use Location" };
      const cancel: MessageItem = { title: "Cancel", isCloseAffordance: true };
      const choice = await window.showWarningMessage(
        `This workspace's .env points Inspect at a remote location: "${value}".`,
        {
          modal: true,
          detail:
            "Using it makes Inspect fetch from (and treat as trusted) that " +
            "location with your ambient credentials. Only approve locations you trust.",
        },
        approve,
        cancel
      );
      if (choice === approve) {
        const approved = this.getApprovedRemoteDirs();
        if (!approved.includes(value)) {
          await this.context_.workspaceState.update(kApprovedRemoteEnvKey, [
            ...approved,
            value,
          ]);
        }
        // Nudge consumers (log listing, etc.) to re-resolve now that the remote
        // location is approved.
        this.onEnvironmentChanged_.fire({ mtime: Date.now() });
      }
    } finally {
      this.pendingRemotePrompts_.delete(value);
    }
  }

  private readonly onEnvironmentChanged_ =
    new EventEmitter<EnvironmentChangedEvent>();
  public readonly onEnvironmentChanged: Event<EnvironmentChangedEvent> =
    this.onEnvironmentChanged_.event;

  [Symbol.dispose](): void {
    throw new Error("Method not implemented.");
  }

  dispose() {
    if (this.envWatcher_) {
      log.appendLine(`Stop watching .env`);
      clearTimeout(this.envWatcher_);
    }
  }
}
