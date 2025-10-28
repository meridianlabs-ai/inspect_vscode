import { ExtensionContext, window } from "vscode";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";
import { activateScanListing } from "./log-listing/scan-listing-provider";
import { end, start } from "../../core/log";
import { PackageManager } from "../../core/package/manager";
import { ScoutConfigurationProvider } from "./env-config-scout-provider";
import { Command } from "../../core/command";
import { ScoutViewServer } from "../scout/scout-view-server";

export async function activateScoutActivityBar(
  scoutManager: PackageManager,
  workspaceEnvMgr: WorkspaceEnvManager,
  workspaceStateMgr: WorkspaceStateManager,
  scoutViewServer: ScoutViewServer,
  context: ExtensionContext
): Promise<Command[]> {
  start("Scan Listing");
  const [scansCommands, scansDispose] = await activateScanListing(
    context,
    workspaceEnvMgr,
    scoutViewServer
  );
  context.subscriptions.push(...scansDispose);
  end("Scan Listing");

  start("Scout Env Configuration");
  const scoutEnvProvider = new ScoutConfigurationProvider(
    context.extensionUri,
    workspaceEnvMgr,
    workspaceStateMgr,
    scoutManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      ScoutConfigurationProvider.viewType,
      scoutEnvProvider
    )
  );
  end("Scout Env Configuration");

  return [...scansCommands];
}
