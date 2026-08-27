import { ExtensionContext, Uri, ViewColumn } from "vscode";

import { showError } from "../../components/error";
import {
  InspectWebview,
  InspectWebviewManager,
} from "../../components/webview";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { OutputWatcher } from "../../core/package/output-watcher";
import { dirname, getRelativeUri } from "../../core/uri";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { selectLogDirectory } from "../activity-bar/log-listing/log-directory-selector";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

import { logPathInScope, LogviewPanel } from "./logview-panel";
import { LogviewState } from "./logview-state";

const kLogViewId = "inspect.logview";

export class InspectViewManager {
  constructor(
    private readonly context_: ExtensionContext,
    private readonly webViewManager_: InspectViewWebviewManager,
    private readonly envMgr_: WorkspaceEnvManager,
    outputWatcher: OutputWatcher
  ) {
    this.context_.subscriptions.push(
      outputWatcher.onInspectLogCreated(async (e) => {
        // if this log is contained in the directory currently being viewed
        // then do a background refresh on it
        if (this.webViewManager_.hasWebview()) {
          await this.webViewManager_.showLogFileIfWithinLogDir(e.log);
        }
      })
    );
  }

  public async showInspectView() {
    // pick a directory
    let log_dir = await selectLogDirectory(this.context_, this.envMgr_);
    if (log_dir === null) {
      log_dir = this.envMgr_.getDefaultLogDir();
    }
    if (log_dir) {
      // Show the log view for the log dir (or the workspace)
      await this.webViewManager_.showLogview({ log_dir }, "activate");
    }
  }

  public async showLogFile(uri: Uri, activation?: "open" | "activate") {
    await this.webViewManager_.showLogFile(uri, activation);
  }

  public logFileWillVisiblyUpdate(uri: Uri): boolean {
    return (
      this.webViewManager_.isVisible() &&
      this.webViewManager_.logFileIsWithinLogDir(uri)
    );
  }

  public viewColumn() {
    return this.webViewManager_.viewColumn();
  }
}

export class InspectViewWebviewManager extends InspectWebviewManager<
  InspectViewWebview,
  InspectViewServer,
  LogviewState
> {
  constructor(
    inspectManager: PackageManager,
    server: InspectViewServer,
    context: ExtensionContext
  ) {
    // If the interpreter changes, refresh the tasks
    context.subscriptions.push(
      inspectManager.onPackageChanged((e: PackageChangedEvent) => {
        if (!e.available && this.activeView_) {
          this.activeView_?.dispose();
        }
      })
    );

    // register view dir as local resource root
    const localResourceRoots: Uri[] = [];
    const viewDir = inspectViewPath();
    if (viewDir) {
      localResourceRoots.push(Uri.file(viewDir.path));
    }
    super(
      context,
      server,
      kLogViewId,
      "Inspect View",
      localResourceRoots,
      InspectViewWebview
    );
  }
  private activeLogDir_: Uri | null = null;

  public async showLogFile(uri: Uri, activation?: "open" | "activate") {
    // Get the directory name using posix path methods
    const log_dir = dirname(uri);

    // Single-file open (the legacy path): confine the panel's RPC scope to this
    // one file, not its entire parent directory, matching the hardened
    // custom-editor path. See CWE-863.
    await this.showLogview(
      { log_file: uri, log_dir, scopeType: "file" },
      activation
    );
  }

  public logFileIsWithinLogDir(log_file: Uri) {
    const state = this.getWorkspaceState();
    return (
      state?.log_dir !== undefined &&
      getRelativeUri(state?.log_dir, log_file) !== null
    );
  }

  public async showLogFileIfWithinLogDir(log_file: Uri) {
    const state = this.getWorkspaceState();
    if (state?.log_dir) {
      if (getRelativeUri(state?.log_dir, log_file) !== null) {
        await this.displayLogFile({
          log_file: log_file,
          log_dir: state?.log_dir,
          background_refresh: true,
        });
      }
    }
  }

  public async showLogview(
    state: LogviewState,
    activation?: "open" | "activate"
  ) {
    // update state for restoring the workspace
    this.setWorkspaceState(state);

    switch (activation) {
      case "open":
        await this.displayLogFile(state, activation);
        break;
      case "activate":
        await this.displayLogFile(state, activation);
        break;
      default:
        // No activation, just refresh this in the background
        if (this.isVisible() && state.log_file) {
          this.updateViewState(state);

          // Signal the viewer to either perform a background refresh
          // or to check whether the view is focused and call us back to
          // display a log file
          await this.activeView_?.backgroundUpdate(
            state.log_file.path,
            state.log_dir.toString()
          );
        }
        return;
    }
  }

  public viewColumn() {
    return this.activeView_?.webviewPanel().viewColumn;
  }

  protected override async onViewStateChanged(): Promise<void> {
    if (this.isActive()) {
      await this.updateVisibleView();
    }
  }

  public async displayLogFile(
    state: LogviewState,
    activation?: "open" | "activate"
  ) {
    // Determine whether we are showing a log viewer for this directory
    // If we aren't close the log viewer so a fresh one can be opened.
    if (
      this.activeLogDir_ !== null &&
      state.log_dir.toString() !== this.activeLogDir_.toString()
    ) {
      // Close it
      this.activeView_?.dispose();
      this.activeView_ = undefined;
    }

    // Note the log directory that we are showing
    this.activeLogDir_ = state.log_dir || null;

    // Update the view state
    this.updateViewState(state);

    // Ensure that we send the state once the view is loaded
    this.setOnShow(() => {
      this.updateVisibleView().catch(() => {});
    });

    // If the view is closed, clear the state
    this.setOnClose(() => {
      this.lastState_ = undefined;
      this.activeLogDir_ = null;
    });

    // Actually reveal or show the webview
    if (this.activeView_) {
      if (activation === "activate") {
        this.revealWebview(activation !== "activate");
      } else if (state.log_file) {
        await this.activeView_?.backgroundUpdate(
          state.log_file.path,
          state.log_dir.toString()
        );
      }
    } else {
      if (activation) {
        this.showWebview(state, {
          preserveFocus: activation !== "activate",
          viewColumn: ViewColumn.One,
        });
      }
    }

    // TODO: there is probably a better way to handle this
    this.activeView_?.setManager(this);
  }

  private async updateVisibleView() {
    if (this.activeView_ && this.isVisible() && this.lastState_) {
      await this.activeView_.update(this.lastState_);
    }
  }

  private updateViewState(state: LogviewState) {
    if (!this.lastState_ || !logStateEquals(state, this.lastState_)) {
      this.lastState_ = state;
    }
  }

  protected override getWorkspaceState(): LogviewState | undefined {
    const data: Record<string, string> = this.context_.workspaceState.get(
      this.kInspectViewState,
      {}
    );
    // Only treat this as trusted state when a real log_dir was persisted.
    // Uri.parse("") resolves to file:/// (whole filesystem), so an empty/never-
    // set value must NOT become a panel scope — fall back to the in-memory
    // last state (undefined on a fresh restore, which disposes the panel).
    if (data && data["log_dir"]) {
      return {
        log_dir: Uri.parse(data["log_dir"]),
        log_file: data["log_file"] ? Uri.parse(data["log_file"]) : undefined,
        background_refresh: !!data["background_refresh"],
        // Persist the scope type so a restored single-file panel keeps its
        // tight "file" scope rather than defaulting back to "dir" (its parent).
        scopeType: data["scopeType"] === "file" ? "file" : undefined,
      };
    } else {
      return this.lastState_;
    }
  }

  // The log view's panel scope (log_dir) is security-relevant, so on restore it
  // must come only from extension-managed workspaceState — never from the
  // webview-persisted state, which a compromised viewer can forge via setState.
  // Returning undefined (no trusted state) disposes the panel rather than
  // restoring it with an attacker-chosen scope. See CWE-642.
  protected override restoreState(): LogviewState | undefined {
    return this.getWorkspaceState();
  }

  protected setWorkspaceState(state: LogviewState) {
    void this.context_.workspaceState.update(this.kInspectViewState, {
      log_dir: state.log_dir.toString(),
      log_file: state.log_file?.toString(),
      background_refresh: state.background_refresh,
      scopeType: state.scopeType,
    });
  }

  private kInspectViewState = "inspectViewState";

  private lastState_?: LogviewState = undefined;
}

const logStateEquals = (a: LogviewState, b: LogviewState) => {
  if (a.log_dir.toString() !== b.log_dir.toString()) {
    return false;
  }

  if (!a.log_file && b.log_file) {
    return false;
  } else if (a.log_file && !b.log_file) {
    return false;
  } else if (a.log_file && b.log_file) {
    return a.log_file.toString() === b.log_file.toString();
  }
  return true;
};

class InspectViewWebview extends InspectWebview<LogviewState> {
  private readonly logviewPanel_: LogviewPanel;

  public constructor(
    context: ExtensionContext,
    server: InspectViewServer,
    state: LogviewState,
    webviewPanel: HostWebviewPanel
  ) {
    super(context, webviewPanel);

    // The panel's authorization scope is fixed here at construction. A "file"
    // scope (legacy single-file open) confines the RPC surface to log_file; the
    // default "dir" scope confines it to descendants of log_dir. The webview
    // cannot change this afterwards (see the displayLogFile handler below).
    this.scopeType_ = state.scopeType ?? "dir";
    this.scopeUri_ =
      this.scopeType_ === "file" && state.log_file
        ? state.log_file
        : state.log_dir;
    this.trustedLogDir_ = state.log_dir;

    this.logviewPanel_ = new LogviewPanel(
      webviewPanel,
      context,
      server,
      this.scopeType_,
      this.scopeUri_
    );
    this._register(this.logviewPanel_);

    this._register(
      this._webviewPanel.webview.onDidReceiveMessage(
        async (e: { type: string; url: string; [key: string]: unknown }) => {
          switch (e.type) {
            case "displayLogFile":
              {
                if (this._manager) {
                  // Messages from the webview are untrusted. Ignore any
                  // webview-supplied log_dir (it would let injected script widen
                  // the panel's scope to an arbitrary directory) and require the
                  // requested file to be within this panel's fixed scope.
                  const requestedFile = Uri.parse(e.url);
                  if (
                    logPathInScope(
                      this.scopeType_,
                      this.scopeUri_,
                      requestedFile.toString()
                    )
                  ) {
                    await this._manager.displayLogFile(
                      { log_file: requestedFile, log_dir: this.trustedLogDir_ },
                      "open"
                    );
                  } else {
                    await showError(
                      "Refusing to display a log outside the current log directory."
                    );
                  }
                } else {
                  await showError(
                    "Unable to display log file because of a missing manager. This is an unexpected error, please report it."
                  );
                }
              }
              break;
          }
        }
      )
    );

    void this.show(state);
  }

  private readonly scopeType_: "file" | "dir";
  private readonly scopeUri_: Uri;
  private readonly trustedLogDir_: Uri;

  public setManager(manager: InspectViewWebviewManager) {
    if (this._manager !== manager) {
      this._manager = manager;
    }
  }
  _manager: InspectViewWebviewManager | undefined;

  public async update(state: LogviewState) {
    await this._webviewPanel.webview.postMessage({
      type: "updateState",
      url: state.log_file?.toString(),
    });
  }

  public async backgroundUpdate(file: string, log_dir: string) {
    await this._webviewPanel.webview.postMessage({
      type: "backgroundUpdate",
      url: file,
      log_dir,
    });
  }

  protected async getHtml(state: LogviewState): Promise<string> {
    return await this.logviewPanel_.getHtml(state);
  }
}
