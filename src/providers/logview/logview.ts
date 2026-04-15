import { ExtensionContext } from "vscode";

import { Command } from "../../core/command";
import { PackageManager } from "../../core/package/manager";
import { OutputWatcher } from "../../core/package/output-watcher";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

import { logviewCommands } from "./commands";
import { activateLogviewEditor } from "./logview-editor";
import { InspectViewManager, InspectViewWebviewManager } from "./logview-view";

export async function activateLogview(
  inspectManager: PackageManager,
  server: InspectViewServer,
  envMgr: WorkspaceEnvManager,
  outputWatcher: OutputWatcher,
  context: ExtensionContext
): Promise<[Command[], InspectViewManager]> {
  // activate the log viewer editor
  activateLogviewEditor(context, server);

  // initilize manager
  const logviewWebManager = new InspectViewWebviewManager(
    inspectManager,
    server,
    context
  );
  const logviewManager = new InspectViewManager(
    context,
    logviewWebManager,
    envMgr,
    outputWatcher
  );

  // logview commands
  return [await logviewCommands(logviewManager), logviewManager];
}
