import { writeFileSync } from "fs";

import { window, workspace } from "vscode";

import { Command } from "../../core/command";
import { workspacePath } from "../../core/path";

export function workspaceEnvCommands() {
  return [new EditEnvFileCommand()];
}

export class EditEnvFileCommand implements Command {
  constructor() {}
  async execute(): Promise<void> {
    // The path to the env file
    const absPath = workspacePath(`.env`);

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
