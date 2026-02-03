import { ExtensionContext } from "vscode";

import { Command } from "../../core/command";
import { scanviewCommands } from "./commands";
import { ScoutViewWebviewManager } from "./scanview-view";
import { ScoutViewManager } from "./scanview-view";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { activateScanviewEditor } from "./scanview-editor";
import { PackageManager } from "../../core/package/manager";
import { ScoutViewServer } from "../scout/scout-view-server";

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
  const scanviewManager = new ScoutViewManager(scanviewWebManager, envMgr);

  // scanview commands
  return [scanviewCommands(context, scanviewManager, envMgr), scanviewManager];
}
