import * as path from "path";

import { TreeItem, TreeItemCollapsibleState } from "vscode";

import * as vscode from "vscode";
import {
  LogNode,
  LogListingTreeDataProvider,
  formatPrettyDateTime,
} from "./log-listing";
import { InspectViewServer } from "../../inspect/inspect-view-server";
import { EvalLog } from "../../../@types/log";
import { evalSummary } from "./log-listing-server-queue";

export class LogTreeDataProvider extends LogListingTreeDataProvider {
  public static readonly viewType = "inspect_ai.logs-view";

  constructor(
    private context_: vscode.ExtensionContext,
    private viewServer_: InspectViewServer
  ) {
    super();
  }

  getTreeItem(element: LogNode): TreeItem {
    // determine some context value attributes
    const contextValue: string[] = [element.type];
    contextValue.push(
      this.logListing_?.uriForNode(element)?.scheme === "file"
        ? "local"
        : "remote"
    );
    contextValue.push(element.name.endsWith(".eval") ? "eval" : "json");

    const uri = this.logListing_?.uriForNode(element);

    // base tree item
    const treeItem: TreeItem = {
      id: element.name,
      iconPath:
        element.iconPath ||
        (element.type === "file"
          ? element.name.endsWith(".eval")
            ? this.context_.asAbsolutePath(
                path.join("assets", "icon", "eval-treeview.svg")
              )
            : new vscode.ThemeIcon(
                "bracket",
                new vscode.ThemeColor("symbolIcon.classForeground")
              )
          : undefined),
      label: element.name.split("/").pop(),
      collapsibleState:
        element.type === "dir"
          ? TreeItemCollapsibleState.Collapsed
          : TreeItemCollapsibleState.None,
      contextValue: contextValue.join("+"),
      tooltip: element.tooltip,
    };

    // make file display nicer
    if (element.type === "file") {
      treeItem.label = element.display_name || "task";
      try {
        const date = parseLogDate(element.name.split("/").pop()!);
        treeItem.description = `${formatPrettyDateTime(date)}`;
      } catch {
        treeItem.description = String(element.name.split("/").pop()!);
      }
    }

    // open files in the editor
    if (element.type === "file") {
      treeItem.command = {
        command: "inspect.openLogViewer",
        title: "View Inspect Log",
        arguments: [uri],
      };
    }
    return treeItem;
  }

  async resolveTreeItem?(item: TreeItem, element: LogNode): Promise<TreeItem> {
    if (item.tooltip) {
      return Promise.resolve(item);
    }

    const nodeUri = this.logListing_?.uriForNode(element);
    if (nodeUri) {
      const headers = await this.viewServer_.evalLogHeaders([
        nodeUri.toString(),
      ]);
      if (headers !== undefined) {
        const evalLog = (JSON.parse(headers) as EvalLog[])[0];
        if (evalLog.version === 2) {
          item.tooltip = evalSummary(evalLog);
        }
      }
    }
    return Promise.resolve(item);
  }
}

function parseLogDate(logName: string) {
  // Take only first bit
  const logDate = logName.split("_")[0];

  // Input validation
  if (!logDate.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}$/)) {
    throw new Error(
      `Unexpcted date format. Expected format: YYYY-MM-DDThh-mm-ss+hh-mm or YYYY-MM-DDThh-mm-ss-hh-mm, got ${logDate}`
    );
  }

  // Convert hyphens to colons only in the time portion (after T) and timezone
  // Leave the date portion (before T) unchanged
  const normalized = logDate.replace(
    /T(\d{2})-(\d{2})-(\d{2})([+-])(\d{2})-(\d{2})/,
    "T$1:$2:$3$4$5:$6"
  );
  const result = new Date(normalized);
  if (isNaN(result.getTime())) {
    throw new Error(`Failed to parse date string: ${normalized}`);
  }

  return result;
}
