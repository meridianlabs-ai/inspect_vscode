import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  Disposable,
  ExtensionContext,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  window,
  workspace,
} from "vscode";

import { userDataDir } from "../../core/appdirs";
import { log } from "../../core/log";
import { kPythonPackageName } from "../../inspect/props";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";

import { readCommandFile } from "./command-file";
import { handleCommandRequest } from "./command-request";

export function activateInspectCommands(
  stateManager: WorkspaceStateManager,
  context: ExtensionContext,
  openLog: (uri: Uri) => Promise<void>
) {
  const dispatcher = new InspectCommandDispatcher(stateManager, openLog);
  context.subscriptions.push(dispatcher);
}

export class InspectCommandDispatcher implements Disposable {
  constructor(
    stateManager: WorkspaceStateManager,
    private readonly openLog_: (uri: Uri) => Promise<void>
  ) {
    this.commandsDir_ = inspectCommandsDir(stateManager);
    this.commandsWatcher_ = workspace.createFileSystemWatcher(
      new RelativePattern(Uri.file(this.commandsDir_), "*"),
      false,
      false,
      true
    );
    // The Python writer creates and then writes the file, without an atomic
    // rename. Observe changes too, and retry incomplete writes for a bounded time.
    this.subscriptions_ = [
      this.commandsWatcher_.onDidCreate((uri) => this.enqueue(uri)),
      this.commandsWatcher_.onDidChange((uri) => this.enqueue(uri)),
    ];
  }

  private enqueue(uri: Uri) {
    if (this.disposed_ || dirname(uri.fsPath) !== this.commandsDir_) return;
    if (this.pending_.size >= 64) {
      this.diagnostic("Too many pending command files.");
      return;
    }
    this.pending_.add(uri.fsPath);
    if (!this.running_) void this.drain();
  }

  private async drain() {
    this.running_ = true;
    try {
      for (const file of this.pending_) {
        if (this.disposed_) break;
        // Keep the path in the set until processing finishes, so duplicate
        // watcher events cannot replay it or open concurrent confirmation dialogs.
        let value: unknown;
        let received = false;
        for (let attempt = 0; attempt < 5 && !this.disposed_; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (this.disposed_) break;
          try {
            value = readCommandFile(file);
            received = true;
            break;
          } catch {
            if (attempt === 4) {
              this.diagnostic(
                "Unreadable, unsafe, oversized, or incomplete command file."
              );
            }
          }
        }
        if (received && !this.disposed_) {
          try {
            await handleCommandRequest(value, {
              confirm: async (targets) => {
                const choice = await window.showWarningMessage(
                  "A local process requested opening Inspect logs. Open only if you expected this request.",
                  {
                    modal: true,
                    detail: targets
                      .map((target) => target.toString())
                      .join("\n"),
                  },
                  "Open Logs"
                );
                return choice === "Open Logs" && !this.disposed_;
              },
              openLog: async (target) => {
                if (!this.disposed_) await this.openLog_(target);
              },
            });
          } catch (error) {
            // Only parser errors are shown verbatim; they contain no file input.
            this.diagnostic(
              error instanceof Error
                ? error.message.slice(0, 256)
                : "Unable to open requested log."
            );
          }
        }
        this.pending_.delete(file);
      }
    } finally {
      this.running_ = false;
    }
  }

  private diagnostic(message: string) {
    // A hostile writer must not flood the output channel with file contents.
    if (Date.now() - this.lastDiagnostic_ >= 5000) {
      log.warn(`Inspect command request rejected: ${message}`);
      this.lastDiagnostic_ = Date.now();
    }
  }

  dispose() {
    this.disposed_ = true;
    this.pending_.clear();
    this.subscriptions_.forEach((subscription) => {
      subscription.dispose();
    });
    this.commandsWatcher_.dispose();
  }

  private readonly commandsDir_: string;
  private readonly commandsWatcher_: FileSystemWatcher;
  private readonly subscriptions_: Disposable[];
  private readonly pending_ = new Set<string>();
  private running_ = false;
  private disposed_ = false;
  private lastDiagnostic_ = 0;
}

function inspectCommandsDir(stateManager: WorkspaceStateManager): string {
  // The python library we're using includes the author name in the path, meaning there are two
  // nested inspect_ai commands.
  const platformPath =
    process.platform === "win32"
      ? join(
          kPythonPackageName,
          kPythonPackageName,
          "vscode",
          stateManager.getWorkspaceInstance(),
          "commands"
        )
      : join(
          kPythonPackageName,
          "vscode",
          stateManager.getWorkspaceInstance(),
          "commands"
        );
  const commandsDir = userDataDir(platformPath);

  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true, mode: 0o700 });
  }

  return commandsDir;
}
