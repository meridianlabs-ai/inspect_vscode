import { ExtensionContext } from "vscode";

import { Command } from "../../core/command";
import { logviewCommands } from "./commands";
import { InspectViewWebviewManager } from "./logview-view";
import { InspectViewManager } from "./logview-view";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { ExtensionHost } from "../../hooks";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { activateLogviewEditor } from "./logview-editor";
import { OutputWatcher } from "../../core/package/output-watcher";
import { PackageManager } from "../../core/package/manager";

export async function activateLogview(
  inspectManager: PackageManager,
  server: InspectViewServer,
  envMgr: WorkspaceEnvManager,
  outputWatcher: OutputWatcher,
  context: ExtensionContext,
  host: ExtensionHost
): Promise<[Command[], InspectViewManager]> {
  // activate the log viewer editor
  activateLogviewEditor(context, server);

  // initilize manager
  const logviewWebManager = new InspectViewWebviewManager(
    inspectManager,
    server,
    context,
    host
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
