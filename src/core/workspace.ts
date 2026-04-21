import { workspace, WorkspaceFolder } from "vscode";

export function activeWorkspaceFolder(): WorkspaceFolder {
  const [folder] = workspace.workspaceFolders ?? [];
  if (!folder) {
    throw new Error("No workspace folder is open");
  }
  return folder;
}

export function checkActiveWorkspaceFolder(): WorkspaceFolder | undefined {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  return workspaceFolder;
}
