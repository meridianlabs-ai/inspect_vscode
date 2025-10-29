import vscode, { Event, EventEmitter, TreeItem } from "vscode";

import { MarkdownString, ThemeIcon, TreeDataProvider, Uri } from "vscode";
import { log } from "../../../core/log";
import { normalizeWindowsUri } from "../../../core/uri";
import { ListingMRU } from "../../../core/listing-mru";
import { throttle } from "lodash";
import { isToday, format, isThisYear } from "date-fns";

export type LogNode =
  | ({
      type: "dir";
      iconPath?: string | ThemeIcon;
      tooltip?: MarkdownString;
      parent?: LogNode;
    } & LogDirectory)
  | ({
      type: "file";
      iconPath?: string | ThemeIcon;
      parent?: LogNode;
    } & LogItem);

export interface LogDirectory {
  name: string;
  children: LogNode[];
}

export interface LogItem {
  name: string;
  mtime: number;
  display_name: string;
  item_id: string;
  tooltip?: MarkdownString;
}

export interface Logs {
  log_dir: string;
  items: LogItem[];
}

export class LogListing {
  constructor(
    private readonly logDir_: Uri,
    private readonly mru_: ListingMRU,
    private readonly logsFetcher_: (uri: Uri) => Promise<Logs | undefined>
  ) {}

  public logDir(): Uri {
    return this.logDir_;
  }

  public async ls(parent?: LogDirectory): Promise<LogNode[]> {
    // fetch the nodes if we don't have them yet
    if (this.nodes_ === undefined) {
      // do the listing
      this.nodes_ = await this.listLogs();

      // track in MRU (add if we got logs, remove if we didn't)
      if (this.nodes_.length > 0) {
        await this.mru_.add(this.logDir());
      } else {
        await this.mru_.remove(this.logDir());
      }
    }

    // if there is no parent, return the root nodes
    if (parent === undefined) {
      return this.nodes_;
    } else {
      // look for the parent and return its children
      const parentNode = this.findParentNode(this.nodes_, parent.name);
      if (parentNode) {
        return parentNode.children;
      }
    }

    return [];
  }

  public uriForNode(node: LogNode) {
    return Uri.joinPath(this.logDir_, node.name);
  }

  public nodeForUri(uri: Uri): LogNode | undefined {
    // recursively look for a node that matches the uri
    const findNodeWithUri = (node: LogNode): LogNode | undefined => {
      if (node.type === "file") {
        return this.uriForNode(node).toString() === uri.toString()
          ? node
          : undefined;
      } else if (node.type === "dir") {
        for (const child of node.children) {
          const uri = findNodeWithUri(child);
          if (uri) {
            return uri;
          }
        }
      }
      return undefined;
    };

    // recursve down through top level nodes
    for (const node of this.nodes_ || []) {
      const foundNode = findNodeWithUri(node);
      if (foundNode) {
        return foundNode;
      }
    }
  }

  public invalidate() {
    this.nodes_ = undefined;
  }

  private async listLogs(): Promise<LogNode[]> {
    try {
      const logs = await this.logsFetcher_(this.logDir_);
      if (logs) {
        const log_dir = normalizeWindowsUri(
          logs.log_dir.endsWith("/") ? logs.log_dir : `${logs.log_dir}/`
        );
        for (const file of logs.items) {
          file.name = normalizeWindowsUri(file.name).replace(`${log_dir}`, "");
        }
        const tree = buildLogTree(logs.items);
        return tree;
      } else {
        log.error(
          `No response retreiving from ${this.logDir_.toString(false)}`
        );
        return [];
      }
    } catch (error) {
      log.error(
        `Unexpected error retreiving from ${this.logDir_.toString(false)}`
      );
      log.error(error instanceof Error ? error : String(error));
      return [];
    }
  }

  private findParentNode(
    nodes: LogNode[],
    parentName: string
  ): LogDirectory | undefined {
    for (const node of nodes) {
      if (node.type === "dir") {
        if (node.name === parentName) {
          return node;
        } else {
          const found = this.findParentNode(node.children, parentName);
          if (found) {
            return found;
          }
        }
      }
    }
    return undefined;
  }

  private nodes_: LogNode[] | undefined;
}

function buildLogTree(logs: LogItem[]): LogNode[] {
  const root: LogNode[] = [];
  const dirCache: Map<string, LogNode> = new Map();

  // Helper to create a directory node
  function createDir(name: string, parent?: LogNode): LogNode {
    return {
      type: "dir",
      name,
      children: [],
      parent,
    };
  }

  // Helper to create a file node
  function createFileNode(file: LogItem, parent?: LogNode): LogNode {
    return {
      ...file,
      type: "file",
      parent,
    };
  }

  // Helper to ensure directory exists and return it
  function ensureDirectory(path: string, parent?: LogNode): LogNode {
    if (dirCache.has(path)) {
      return dirCache.get(path)!;
    }

    const dir = createDir(path, parent);
    dirCache.set(path, dir);
    return dir;
  }

  // Process each log file
  for (const log of logs) {
    const parts = log.name.split("/");
    parts.pop()!; // remove the filename
    let currentParent: LogNode | undefined;
    let currentPath = "";

    // Create/get all necessary parent directories
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const parentDir = currentParent;
      currentParent = ensureDirectory(currentPath, parentDir);

      if (parentDir?.type === "dir") {
        if (!parentDir.children.some(child => child.name === currentPath)) {
          parentDir.children.push(currentParent);
        }
      } else if (!root.some(node => node.name === currentPath)) {
        root.push(currentParent);
      }
    }

    // Create and add the file node
    const fileNode = createFileNode(log, currentParent);
    if (currentParent?.type === "dir") {
      currentParent.children.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  return sortLogTree(root);
}

function sortLogTree(nodes: LogNode[]): LogNode[] {
  // sort all of the children
  for (const node of nodes) {
    if (node.type === "dir") {
      node.children = sortLogTree(node.children);
    }
  }

  // sort this level
  return nodes.sort((a, b) => {
    if (a.type === "dir" && b.type === "dir") {
      // Allow folders to follow their natural order
      return 0;
    } else if (a.type === "file" && b.type === "file") {
      return b.mtime - a.mtime;
    } else if (a.type === "dir") {
      return -1;
    } else {
      return 1;
    }
  });
}

export abstract class LogListingTreeDataProvider
  implements TreeDataProvider<LogNode>, vscode.Disposable
{
  private readonly throttledRefresh_: () => void;

  constructor() {
    this.throttledRefresh_ = throttle(() => {
      this.logListing_?.invalidate();
      this._onDidChangeTreeData.fire();
    }, 1000);
  }

  dispose() {}

  public setLogListing(logListing: LogListing) {
    this.logListing_ = logListing;
    this.refresh();
  }

  public getLogListing(): LogListing | undefined {
    return this.logListing_;
  }

  public refresh(): void {
    this.throttledRefresh_();
  }

  abstract getTreeItem(element: LogNode): TreeItem;

  async getChildren(element?: LogNode): Promise<LogNode[]> {
    if (!element || element.type === "dir") {
      return (await this.logListing_?.ls(element)) || [];
    } else {
      return [];
    }
  }

  getParent(element: LogNode): LogNode | undefined {
    return element.parent;
  }

  private _onDidChangeTreeData: EventEmitter<
    LogNode | undefined | null | void
  > = new vscode.EventEmitter<LogNode | undefined | null | void>();
  readonly onDidChangeTreeData: Event<LogNode | undefined | null | void> =
    this._onDidChangeTreeData.event;

  protected logListing_?: LogListing;
}
export function formatPrettyDateTime(date: Date) {
  // For today, just show time
  if (isToday(date)) {
    return `Today, ${format(date, "h:mmaaa")}`;
  }

  // For this year, show month and day
  if (isThisYear(date)) {
    return format(date, "MMM d, h:mmaaa");
  }

  // For other years, include the year
  return format(date, "MMM d yyyy, h:mmaaa");
}
