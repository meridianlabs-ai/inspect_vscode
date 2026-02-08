import * as vscode from "vscode";

import { Command } from "../../../core/command";

import { WorkspaceEnvManager } from "../../workspace/workspace-env-provider";
import { LogItem, LogListing, LogNode, Logs } from "./log-listing";
import { activeWorkspaceFolder } from "../../../core/workspace";
import { getRelativeUri, prettyUriPath } from "../../../core/uri";
import { Uri } from "vscode";
import { ScansTreeDataProvider } from "./scan-listing-data";
import { ScoutViewServer } from "../../scout/scout-view-server";
import { ScanResultsListingMRU } from "../../scanview/scanview-view";
import { stringify } from "yaml";
import { OutputWatcher } from "../../../core/package/output-watcher";

export async function activateScanListing(
  context: vscode.ExtensionContext,
  envManager: WorkspaceEnvManager,
  viewServer: ScoutViewServer,
  outputWatcher: OutputWatcher
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
    const logsFetcher = async (uri: Uri): Promise<Logs | undefined> => {
      const scansJSON = await viewServer.getScans(uri);
      if (scansJSON) {
        const scans = JSON.parse(scansJSON) as {
          items: Array<ScanRow>;
        };
        return {
          log_dir: logDir.toString(),
          items: scans.items.map(scanToLogItem),
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

  // Register reveal command
  disposables.push(
    vscode.commands.registerCommand(
      "inspect.scanListingReveal",
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

  // Register Reveal in Explorer command
  disposables.push(
    vscode.commands.registerCommand(
      "inspect.scanListingRevealInExplorer",
      async (node: LogNode) => {
        const logUri = treeDataProvider.getLogListing()?.uriForNode(node);
        if (logUri) {
          await vscode.commands.executeCommand("revealInExplorer", logUri);
        }
      }
    )
  );

  // Register delete log file command
  disposables.push(
    vscode.commands.registerCommand(
      "inspect.scanListingDeleteScan",
      async (node: LogNode) => {
        const logUri = treeDataProvider.getLogListing()?.uriForNode(node);
        if (logUri) {
          const result = await vscode.window.showInformationMessage(
            "Delete Scan",
            {
              modal: true,
              detail: `Are you sure you want to delete the scan at ${prettyUriPath(logUri)}?`,
            },
            { title: "Delete", isCloseAffordance: false },
            { title: "Cancel", isCloseAffordance: true }
          );

          if (result?.title === "Delete") {
            await viewServer.deleteScan(logUri);
            treeDataProvider.refresh();
          }
        }
      }
    )
  );

  // Register refresh command
  disposables.push(
    vscode.commands.registerCommand("inspect.scanListingRefresh", () => {
      treeDataProvider.refresh();
    })
  );

  // Register update command (for when the log directory changes )
  disposables.push(
    vscode.commands.registerCommand("inspect.scanListingUpdate", () => {
      updateTree();
    })
  );

  // refresh when a scan occurs
  disposables.push(
    outputWatcher.onScoutScanCreated(e => {
      const treeLogDir = treeDataProvider.getLogListing()?.logDir();
      if (treeLogDir && getRelativeUri(treeLogDir, e.scan)) {
        treeDataProvider.refresh();
      }
    })
  );

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

// TODO: This belongs as reead from api-types in mono repo
interface ScanRow {
  /** Active Completion Pct */
  active_completion_pct?: number | null;
  /** Location */
  location: string;
  /** Metadata */
  metadata?: {
    [key: string]: unknown;
  } | null;
  /** Model */
  model?: string | null;
  /** Packages */
  packages: {
    [key: string]: string;
  };
  /** Revision Commit */
  revision_commit?: string | null;
  /** Revision Origin */
  revision_origin?: string | null;
  /** Revision Version */
  revision_version?: string | null;
  /** Scan Args */
  scan_args?: {
    [key: string]: unknown;
  } | null;
  /** Scan File */
  scan_file?: string | null;
  /** Scan Id */
  scan_id: string;
  /** Scan Name */
  scan_name: string;
  /** Scanners */
  scanners: string;
  /**
   * Status
   * @enum {string}
   */
  status: "active" | "error" | "complete" | "incomplete";
  /** Tags */
  tags: string;
  /**
   * Timestamp
   * Format: date-time
   */
  timestamp: string;
  /** Total Errors */
  total_errors: number;
  /** Total Results */
  total_results: number;
  /** Total Tokens */
  total_tokens: number;
  /** Transcript Count */
  transcript_count: number;
}

function scanToLogItem(scan: ScanRow): LogItem {
  // display name
  let display_name = scan.scan_name;

  // if the name is generic and there is a scan file then use that
  if (["scan", "job"].includes(display_name) && scan.scan_file) {
    display_name = scan.scan_file.split(/[\\/]/).pop() || display_name;
  }

  // compute stats
  const transcripts = scan.transcript_count;

  // build tooltip
  const tooltip = [
    `### ${display_name}`,
    "",
    "",
    `${transcripts} transcripts  `,
    `scan_id=${scan.scan_id}  `,
    "",
    "",
  ];

  const config = scanConfig(scan);
  if (config) {
    tooltip.push(`${config.join("\n")}`);
  }

  return {
    name: scan.location,
    mtime: new Date(scan.timestamp).getTime(),
    display_name,
    item_id: scan.scan_id,
    tooltip: new vscode.MarkdownString(tooltip.join("\n"), true),
  };
}

function scanConfig(scan: ScanRow): string[] | undefined {
  const config: Record<string, unknown> = {};

  // model
  if (scan.model) {
    config["model"] = scan.model;
  }

  if (Object.keys(config).length > 0) {
    return ["```", `\n${stringify(config)}`, "```"];
  } else {
    return undefined;
  }
}
