import { ExtensionContext, window } from "vscode";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { activateScanListing } from "./log-listing/scan-listing-provider";
import { end, start } from "../../core/log";
import { PackageManager } from "../../core/package/manager";
import { ScoutPanelProvider } from "./scout-panel-provider";
import { Command } from "../../core/command";
import { ScoutViewServer } from "../scout/scout-view-server";
import { OutputWatcher } from "../../core/package/output-watcher";

export async function activateScoutActivityBar(
  scoutManager: PackageManager,
  workspaceEnvMgr: WorkspaceEnvManager,
  scoutViewServer: ScoutViewServer,
  outputWatcher: OutputWatcher,
  context: ExtensionContext
): Promise<Command[]> {
  start("Scan Listing");
  const [scansCommands, scansDispose] = await activateScanListing(
    context,
    workspaceEnvMgr,
    scoutViewServer,
    outputWatcher
  );
  context.subscriptions.push(...scansDispose);
  end("Scan Listing");

  start("Scout Panel");
  const scoutPanelProvider = new ScoutPanelProvider(
    context.extensionUri,
    scoutManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      ScoutPanelProvider.viewType,
      scoutPanelProvider
    ),
    scoutPanelProvider
  );
  end("Scout Panel");

  return [...scansCommands];
}
