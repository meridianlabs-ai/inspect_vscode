import { writeFileSync } from "fs";

import { window, workspace } from "vscode";

import { Command } from "../../core/command";
import { envFilePathIsSafe } from "../../core/env";
import { workspacePath } from "../../core/path";
import { activeWorkspaceFolder } from "../../core/workspace";

export function workspaceEnvCommands() {
  return [new EditEnvFileCommand()];
}

export class EditEnvFileCommand implements Command {
  constructor() {}
  async execute(): Promise<void> {
    // The path to the env file
    const absPath = workspacePath(`.env`);

    // Refuse to touch .env through a symlink that redirects outside the
    // workspace (append mode would otherwise create the symlink's target).
    const workspaceFolder = activeWorkspaceFolder();
    if (
      !workspaceFolder ||
      !envFilePathIsSafe(absPath.path, workspaceFolder.uri.fsPath)
    ) {
      await window.showErrorMessage(
        "Unable to edit .env: it is a symlink or resolves outside the workspace."
      );
      return;
    }

    // Ensure env file actually exists (append mode creates the file if
    // missing without truncating one created in the meantime)
    writeFileSync(absPath.path, "", { encoding: "utf-8", flag: "a" });

    // Open the env file
    const document = await workspace.openTextDocument(absPath.path);
    await window.showTextDocument(document);
  }

  private static readonly id = "inspect.editEnvFile";
  public readonly id = EditEnvFileCommand.id;
}
