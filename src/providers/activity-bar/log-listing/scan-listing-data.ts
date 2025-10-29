import { TreeItem, TreeItemCollapsibleState } from "vscode";

import * as vscode from "vscode";
import {
  LogNode,
  LogListingTreeDataProvider,
  formatPrettyDateTime,
} from "./log-listing";

export class ScansTreeDataProvider extends LogListingTreeDataProvider {
  public static readonly viewType = "inspect_ai.scans-view";

  constructor() {
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

    const uri = this.logListing_?.uriForNode(element);

    // base tree item
    const treeItem: TreeItem = {
      id: element.name,
      iconPath:
        element.iconPath ||
        (element.type === "file"
          ? new vscode.ThemeIcon(
              "bracket",
              new vscode.ThemeColor("symbolIcon.classForeground")
            )
          : undefined),
      label:
        element.type == "file"
          ? element.display_name
          : element.name.split("/").pop(),
      collapsibleState:
        element.type === "dir"
          ? TreeItemCollapsibleState.Collapsed
          : TreeItemCollapsibleState.None,
      contextValue: contextValue.join("+"),
      tooltip: element.tooltip,
    };

    // make file display nicer
    if (element.type === "file") {
      treeItem.label = element.display_name;
      try {
        treeItem.description = `${formatPrettyDateTime(new Date(element.mtime))}`;
      } catch {}
    }

    // open files in the editor
    if (element.type === "file") {
      treeItem.command = {
        command: "inspect.openScanViewer",
        title: "View Scout Scan",
        arguments: [uri],
      };
    }
    return treeItem;
  }

  async resolveTreeItem?(item: TreeItem, _element: LogNode): Promise<TreeItem> {
    return Promise.resolve(item);
  }
}
