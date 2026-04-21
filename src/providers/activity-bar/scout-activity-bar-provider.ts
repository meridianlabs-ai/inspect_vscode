import { ExtensionContext, window } from "vscode";

import { Command } from "../../core/command";
import { end, start } from "../../core/log";
import { PackageManager } from "../../core/package/manager";
import { OutputWatcher } from "../../core/package/output-watcher";
import { ScoutProjectManager } from "../scout/scout-project";
import { ScoutViewServer } from "../scout/scout-view-server";

import { activateScanListing } from "./log-listing/scan-listing-provider";
import { ScoutPanelProvider } from "./scout-panel-provider";

export async function activateScoutActivityBar(
  scoutManager: PackageManager,
  scoutProjectManager: ScoutProjectManager,
  scoutViewServer: ScoutViewServer,
  outputWatcher: OutputWatcher,
  context: ExtensionContext
): Promise<Command[]> {
  start("Scan Listing");
  const [scansCommands, scansDispose] = await activateScanListing(
    context,
    scoutProjectManager,
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
