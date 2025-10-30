import { ExtensionContext } from "vscode";

import { LogListingMRU } from "./log-listing-mru";
import { WorkspaceEnvManager } from "../../workspace/workspace-env-provider";
import { selectDirectory } from "../../../core/select";

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
