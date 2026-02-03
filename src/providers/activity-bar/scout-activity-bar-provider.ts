import { ExtensionContext } from "vscode";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { activateScanListing } from "./log-listing/scan-listing-provider";
import { end, start } from "../../core/log";
import { Command } from "../../core/command";
import { ScoutViewServer } from "../scout/scout-view-server";
import { OutputWatcher } from "../../core/package/output-watcher";

export async function activateScoutActivityBar(
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

  return [...scansCommands];
}
