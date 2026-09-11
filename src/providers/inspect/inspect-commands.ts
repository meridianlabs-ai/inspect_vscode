import { existsSync, mkdirSync, opendirSync, unlinkSync } from "node:fs";
import { join, posix, win32 } from "node:path";

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
import { CommandRequestActions, handleCommandRequest } from "./command-request";

export function activateInspectCommands(
  stateManager: WorkspaceStateManager,
  context: ExtensionContext,
  openLog: (uri: Uri) => Promise<void>
) {
  const dispatcher = new InspectCommandDispatcher(
    inspectCommandsDir(stateManager),
    {
      confirm: async (targets) => {
        const choice = await window.showWarningMessage(
          "A local process requested opening Inspect logs. Open only if you expected this request.",
          {
            modal: true,
            detail: targets.map((target) => target.toString()).join("\n"),
          },
          "Open Logs"
        );
        return choice === "Open Logs";
      },
      openLog,
    }
  );
  context.subscriptions.push(dispatcher);
}

/** Compare using the extension host's filesystem rules (including Windows casing). */
export function isDirectCommandFile(
  directory: string,
  file: string,
  platform = process.platform
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  return paths.relative(directory, paths.dirname(file)) === "";
}

export class InspectCommandDispatcher implements Disposable {
  constructor(
    private readonly commandsDir_: string,
    private readonly actions_: CommandRequestActions,
    private readonly notifyRejected_: (message: string) => void = (message) => {
      void window.showWarningMessage(message);
    }
  ) {
    // Do not execute requests left by a previous session. Bound enumeration and
    // cleanup too: a writer can put arbitrarily many entries in this directory.
    const directory = opendirSync(this.commandsDir_);
    try {
      for (let count = 0; count < 64; count++) {
        const entry = directory.readSync();
        if (!entry) break;
        if (entry.isFile() || entry.isSymbolicLink()) {
          try {
            unlinkSync(join(this.commandsDir_, entry.name));
          } catch {
            this.diagnostic("Unable to remove a stale command file.");
          }
        }
      }
    } finally {
      directory.closeSync();
    }
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
    if (this.disposed_ || !isDirectCommandFile(this.commandsDir_, uri.fsPath))
      return;
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
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (this.disposed_) break;
          try {
            value = readCommandFile(file);
            received = true;
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
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
              confirm: async (targets) =>
                (await this.actions_.confirm(targets)) && !this.disposed_,
              openLog: async (target) => {
                if (!this.disposed_) await this.actions_.openLog(target);
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
      const diagnostic = `Inspect command request rejected: ${message}`;
      log.warn(diagnostic);
      this.notifyRejected_(diagnostic);
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
