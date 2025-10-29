import * as vscode from "vscode";

import { Command } from "../../../core/command";

import { WorkspaceEnvManager } from "../../workspace/workspace-env-provider";
import { LogListing, Logs } from "./log-listing";
import { activeWorkspaceFolder } from "../../../core/workspace";
import { getRelativeUri, prettyUriPath } from "../../../core/uri";
import { Uri } from "vscode";
import { ScansTreeDataProvider } from "./scan-listing-data";
import { ScoutViewServer } from "../../scout/scout-view-server";
import { ScanResultsListingMRU } from "../../scanview/scanview-view";

export async function activateScanListing(
  context: vscode.ExtensionContext,
  envManager: WorkspaceEnvManager,
  viewServer: ScoutViewServer
): Promise<[Command[], vscode.Disposable[]]> {
  const kScanResultsDir = "inspect_ai.scanResultsDir";
  const disposables: vscode.Disposable[] = [];

  // create tree data provider and tree
  const treeDataProvider = new ScansTreeDataProvider();
  disposables.push(treeDataProvider);
  const tree = vscode.window.createTreeView(ScansTreeDataProvider.viewType, {
    treeDataProvider,
    showCollapseAll: false,
    canSelectMany: false,
  });

  // update the tree based on the current preferred log dir
  const updateTree = () => {
    // see what the active scan dir is
    const preferredLogDir = context.workspaceState.get<string>(kScanResultsDir);
    const logDir = preferredLogDir
      ? Uri.parse(preferredLogDir)
      : envManager.getDefaultScanResultsDir();

    // create a logs fetcher
    const logsFetcher = async (_uri: Uri): Promise<Logs | undefined> => {
      const scansJSON = await viewServer.getScans();
      if (scansJSON) {
        const scans = JSON.parse(scansJSON) as {
          results_dir: string;
          scans: Array<{
            location: string;
            spec: {
              scan_id: string;
              scan_file?: string;
              timestamp: string;
            };
          }>;
        };
        return {
          log_dir: scans.results_dir,
          items: scans.scans.map(scan => ({
            name: scan.location,
            mtime: new Date(scan.spec.timestamp).getTime(),
            display_name: `scan_id=${scan.spec.scan_id}`,
            item_id: scan.spec.scan_id,
          })),
        };
      } else {
        return undefined;
      }
    };

    // set it
    treeDataProvider.setLogListing(
      new LogListing(logDir, new ScanResultsListingMRU(context), logsFetcher)
    );
    // show a workspace relative path if this is in the workspace,
    // otherwise show the protocol then the last two bits of the path
    const relativePath = getRelativeUri(activeWorkspaceFolder().uri, logDir);
    if (relativePath) {
      tree.description = `./${relativePath}`;
    } else {
      tree.description = prettyUriPath(logDir);
    }
  };

  // initial tree update
  updateTree();

  // update tree if the environment changes and we are tracking the workspace log dir
  disposables.push(
    envManager.onEnvironmentChanged(() => {
      if (context.workspaceState.get<string>(kScanResultsDir) === undefined) {
        updateTree();
      }
    })
  );

  /*
  // Register select log dir command
  disposables.push(
    vscode.commands.registerCommand("inspect.logListing", async () => {
      const logLocation = await selectLogDirectory(context, envManager);
      if (logLocation !== undefined) {
        // store state ('null' means use workspace default so pass 'undefined' to clear for that)
        await context.workspaceState.update(
          kLogListingDir,
          logLocation === null ? undefined : logLocation.toString()
        );

        // trigger update
        updateTree();

        // reveal
        await revealLogListing();
      }
    })
  );

  // Register reveal command
  disposables.push(
    vscode.commands.registerCommand(
      "inspect.logListingReveal",
      async (uri?: Uri) => {
        const treeLogUri = treeDataProvider.getLogListing()?.logDir();
        if (treeLogUri && uri && getRelativeUri(treeLogUri, uri) !== null) {
          const node = treeDataProvider.getLogListing()?.nodeForUri(uri);
          if (node) {
            await tree.reveal(node);
          }
        }
      }
    )
  );

  // Register refresh command
  disposables.push(
    vscode.commands.registerCommand("inspect.logListingRefresh", () => {
      treeDataProvider.refresh();
    })
  );

  // Register update command (for when the log directory changes )
  disposables.push(
    vscode.commands.registerCommand("inspect.logListingUpdate", () => {
      updateTree();
    })
  );


  */

  // refresh when a log in our directory changes
  // disposables.push(
  //   logsWatcher.onInspectLogCreated(e => {
  //     const treeLogDir = treeDataProvider.getLogListing()?.logDir();
  //     if (treeLogDir && getRelativeUri(treeLogDir, e.log)) {
  //       treeDataProvider.refresh();
  //     }
  //   })
  // );

  // refresh on change visiblity
  disposables.push(
    tree.onDidChangeVisibility(e => {
      if (e.visible) {
        treeDataProvider.refresh();
      }
    })
  );

  return Promise.resolve([[], disposables]);
}

export async function revealScanListing() {
  await vscode.commands.executeCommand("workbench.action.focusSideBar");
  await vscode.commands.executeCommand(
    `workbench.view.extension.inspect_ai-activity-bar-scout`
  );
}
