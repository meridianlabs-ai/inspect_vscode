import { ExtensionContext, Uri, workspace } from "vscode";

import { Command } from "../../core/command";
import { PackageManager } from "../../core/package/manager";
import { kScoutEnvValues } from "../scout/scout-constants";
import { ScoutProjectManager } from "../scout/scout-project";
import { ScoutViewServer } from "../scout/scout-view-server";
import {
  scoutLocationToUri,
  WorkspaceEnvManager,
} from "../workspace/workspace-env-provider";

import { scanviewCommands } from "./commands";
import { activateScanviewEditor } from "./scanview-editor";
import { ScoutViewManager, ScoutViewWebviewManager } from "./scanview-view";

export function activateScanview(
  scoutManager: PackageManager,
  server: ScoutViewServer,
  envMgr: WorkspaceEnvManager,
  scoutProjectManager: ScoutProjectManager,
  context: ExtensionContext
): [Command[], ScoutViewManager] {
  // Confine the full Scout View's webview RPC methods to the configured scan
  // results directory plus the open workspace folders, so injected webview
  // script can't read arbitrary paths/URIs via the token-authorized server.
  server.setScanResultsScope(() => {
    const roots: Uri[] = [envMgr.getDefaultScanResultsDir()];
    for (const folder of workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    return roots;
  });

  // The scan webviews read transcripts from the project's configured
  // transcripts location (scout.yaml, or the SCOUT_SCAN_TRANSCRIPTS override),
  // which is usually not under the scan results dir — admit it for the
  // transcripts routes only.
  server.setTranscriptsScope(() => {
    const roots: Uri[] = [];
    const configured = scoutProjectManager.getConfig().transcripts;
    const fromEnv = envMgr.getValues()[kScoutEnvValues.scanTranscripts];
    for (const location of [configured, fromEnv]) {
      if (typeof location === "string" && location) {
        roots.push(scoutLocationToUri(location));
      }
    }
    return roots;
  });

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
