import { ExtensionContext } from "vscode";

import { Command } from "../../core/command";
import { PackageManager } from "../../core/package/manager";
import { ScoutViewServer } from "../scout/scout-view-server";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

import { scanviewCommands } from "./commands";
import { activateScanviewEditor } from "./scanview-editor";
import { ScoutViewManager, ScoutViewWebviewManager } from "./scanview-view";

export function activateScanview(
  scoutManager: PackageManager,
  server: ScoutViewServer,
  envMgr: WorkspaceEnvManager,
  context: ExtensionContext
): [Command[], ScoutViewManager] {
  // activate the log viewer editor
  activateScanviewEditor(context, server);

  // initilize manager
  const scanviewWebManager = new ScoutViewWebviewManager(
    scoutManager,
    server,
    context
  );
  const scanviewManager = new ScoutViewManager(scanviewWebManager);

  // scanview commands
  return [scanviewCommands(context, scanviewManager, envMgr), scanviewManager];
}
