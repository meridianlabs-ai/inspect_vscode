import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  commands,
  Disposable,
  ExtensionContext,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  workspace,
} from "vscode";

import { userDataDir } from "../../core/appdirs";
import { removeFilesSync } from "../../core/file";
import { log } from "../../core/log";
import { parseTerminalLinkUri } from "../../core/uri";
import { kPythonPackageName } from "../../inspect/props";
import { validateLogUri } from "../protocol-handler";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";

// The command-file channel exists only so the inspect_ai/inspect_scout Python
// packages can ask VS Code to open a log or scan viewer. The directory is not
// protected by a secret (the workspace id is enumerable, low-entropy, and
// exported into every terminal's environment), so any same-user or
// data-dir-mounted writer can drop a file here. Restrict dispatch to an explicit
// allowlist and validate each command's target URI exactly as the vscode://
// protocol handler does, so a dropped file naming e.g.
// workbench.action.terminal.sendSequence is ignored. See CWE-749.
function isAllowedDispatch(command: string, args: unknown[]): boolean {
  const arg0 = args[0];
  switch (command) {
    case "inspect.openLogViewer": {
      if (typeof arg0 !== "string") {
        return false;
      }
      let uri: Uri;
      try {
        uri = Uri.parse(arg0);
      } catch {
        return false;
      }
      return validateLogUri(uri) === null;
    }
    case "inspect.openScanViewer": {
      // Scan targets are directories (no log extension); accept only the
      // schemes Inspect supports and reject file:// URIs carrying an authority
      // (UNC), matching the terminal-link guard.
      return typeof arg0 === "string" && parseTerminalLinkUri(arg0) !== null;
    }
    default:
      return false;
  }
}

export function activateInspectCommands(
  stateManager: WorkspaceStateManager,
  context: ExtensionContext
) {
  const inspectCommands = new InspectCommandDispatcher(stateManager);
  context.subscriptions.push(inspectCommands);
}

export class InspectCommandDispatcher implements Disposable {
  constructor(stateManager: WorkspaceStateManager) {
    // init commands dir and remove any existing commands
    this.commandsDir_ = inspectCommandsDir(stateManager);
    this.collectCommandsRequest();

    this.commandsWatcher_ = workspace.createFileSystemWatcher(
      new RelativePattern(Uri.file(this.commandsDir_), "*"),
      false,
      true,
      true
    );
    this.commandsWatcher_.onDidCreate(async () => {
      const commandsRequest = this.collectCommandsRequest();
      if (commandsRequest) {
        for (const command of commandsRequest) {
          log.appendLine(`Found command: ${command.command}`);
          const args = command.args ?? [];
          if (!isAllowedDispatch(command.command, args)) {
            log.appendLine(
              `Ignoring disallowed or invalid dispatched command: ${command.command}`
            );
            continue;
          }
          log.appendLine(`Executing VS Code command ${command.command}`);
          try {
            log.info(
              `Executing command: ${command.command} with args: ${JSON.stringify(args)}`
            );
            await commands.executeCommand(command.command, ...args);
          } catch (error) {
            log.error(error instanceof Error ? error : String(error));
          }
        }
      }
    });
    log.appendLine(`Watching for commands`);
  }

  collectCommandsRequest(): Array<{ command: string; args: unknown[] }> | null {
    const commandFiles = readdirSync(this.commandsDir_);
    if (commandFiles.length > 0) {
      // read at most a single command and remove all of the others
      const [commandFile] = commandFiles;
      if (!commandFile) {
        return null;
      }
      const commandContents = readFileSync(
        join(this.commandsDir_, commandFile),
        { encoding: "utf-8" }
      );
      removeFilesSync(
        commandFiles.map((file) => join(this.commandsDir_, file))
      );
      return JSON.parse(commandContents) as Array<{
        command: string;
        args: unknown[];
      }>;
    } else {
      return null;
    }
  }

  dispose() {
    if (this.commandsWatcher_) {
      log.appendLine("Stopping watching for commands");
      this.commandsWatcher_.dispose();
    }
  }

  private commandsDir_: string;
  private commandsWatcher_: FileSystemWatcher;
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
    mkdirSync(commandsDir, { recursive: true });
  }

  return commandsDir;
}
