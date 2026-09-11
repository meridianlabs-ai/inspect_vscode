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
import {
  captureProjectAuthority,
  defaultProjectTranscripts,
} from "./project-authority";
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
  const configuredScanRoots: Uri[] = [];
  server.setScanResultsScope(() => {
    const roots: Uri[] = [
      envMgr.getDefaultScanResultsDir(),
      ...configuredScanRoots,
    ];
    for (const folder of workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    return roots;
  });

  // Take project authority once, before serving webview requests. Later
  // project/config writes may change defaults but cannot mint new roots, even
  // if another panel is opened. Environment locations remain host settings.
  // Workspace folder changes are explicit host actions, unlike project edits.
  server.projectScope = () =>
    (workspace.workspaceFolders ?? []).map((folder) => folder.uri);
  const transcriptRoots: Uri[] = [];
  const modelEndpoints: string[] = [];
  server.modelEndpoints = () => {
    const fromEnv = envMgr.getValues()[kScoutEnvValues.modelBaseUrl];
    return typeof fromEnv === "string"
      ? [...modelEndpoints, fromEnv]
      : [...modelEndpoints];
  };
  server.scopeReady = scoutProjectManager.ready.then(async () => {
    const config = await scoutProjectManager.getAuthorityConfig();
    // Match Scout's default preference: an existing ./transcripts directory,
    // then the host's Inspect log directory. Both are fixed for this snapshot.
    if (!config.transcripts) {
      config.transcripts = await defaultProjectTranscripts(
        server.projectScope()[0],
        envMgr.getDefaultLogDir()
      );
    }
    const authority = captureProjectAuthority(config, scoutLocationToUri);
    transcriptRoots.push(...authority.transcripts);
    configuredScanRoots.push(...authority.scans);
    modelEndpoints.push(...authority.modelEndpoints);
  });
  server.setTranscriptsScope(() => {
    const roots = [...transcriptRoots];
    const fromEnv = envMgr.getValues()[kScoutEnvValues.scanTranscripts];
    if (typeof fromEnv === "string" && fromEnv)
      roots.push(scoutLocationToUri(fromEnv));
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
