import { ExtensionContext } from "vscode";
import { WorkspaceStateManager } from "./workspace/workspace-state-provider";
import { log } from "../core/log";

export async function activateWorkspaceEnvironment(
  context: ExtensionContext,
  stateManager: WorkspaceStateManager
) {
  // Set up our terminal environment
  // Update the workspace id used in our terminal environments
  await stateManager.initializeWorkspaceId();

  const workspaceId = stateManager.getWorkspaceInstance();
  const version = extensionVersion(context);

  const env = context.environmentVariableCollection;
  log.append(`Workspace: ${workspaceId}`);
  log.append(`Version: ${version}`);
  log.append(`Resetting Terminal Workspace:`);

  env.delete("INSPECT_WORKSPACE_ID");
  env.append("INSPECT_WORKSPACE_ID", workspaceId);

  env.delete("INSPECT_VSCODE_EXT_VERSION");
  env.append("INSPECT_VSCODE_EXT_VERSION", version);
}

export const extensionVersion = (context: ExtensionContext) => {
  return `${(context.extension.packageJSON as { version: string }).version}`;
};
