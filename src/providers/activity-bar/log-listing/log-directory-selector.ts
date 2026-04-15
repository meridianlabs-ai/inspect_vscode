import { ExtensionContext } from "vscode";

import { selectDirectory } from "../../../core/select";
import { WorkspaceEnvManager } from "../../workspace/workspace-env-provider";

import { LogListingMRU } from "./log-listing-mru";

export async function selectLogDirectory(
  context: ExtensionContext,
  envManager: WorkspaceEnvManager
) {
  return await selectDirectory(
    "Log Directory",
    "logs",
    envManager.getDefaultLogDir(),
    new LogListingMRU(context)
  );
}
