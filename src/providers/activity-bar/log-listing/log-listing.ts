import * as os from "os";
import path from "path";

import { format, isThisYear, isToday } from "date-fns";
import { throttle } from "lodash";
import vscode, {
  Event,
  EventEmitter,
  MarkdownString,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  Uri,
} from "vscode";

import { ListingMRU } from "../../../core/listing-mru";
import { log } from "../../../core/log";
import { isUri, normalizeWindowsUri, resolveToUri } from "../../../core/uri";

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

/**
 * Computes a log-dir-relative path for a listing item location, or null if the
 * location is not contained within the log directory.
 *
 * Listing names come from the view server / remote storage (e.g. S3 keys),
 * which may contain literal '..' segments, so a name must never be trusted to
 * stay inside the log dir. The exact string-prefix fast path is kept (the
 * server usually returns locations in the requested form) but is rejected if
 * the relative part contains a '..' escape; otherwise fall back to the
 * containment-checked getRelativeUri. Locations outside the log dir return null
 * so the caller can drop them rather than surface an out-of-boundary entry.
 *
 * Names with '.' or empty segments ('team/./x.eval', 'team//x.eval',
 * '/a.eval', 'x.eval/') are dropped as well. Tree item ids and the URI a node
 * opens come from Uri.joinPath, which normalizes those segments away, so such
 * a name would share an id with — and open — a different entry (for an S3 key
 * a different object). They are not the log directory's own listing form, so
 * nothing legitimate is lost.
 *
 * That check follows Uri.joinPath's own segment rules: '/' always separates,
 * and '\' separates only for a file location on Windows (win32 joining). For
 * S3 keys and POSIX file names a backslash is an ordinary character that
 * joinPath preserves, so 'team/\x.eval' stays a distinct, valid entry there.
 * The '..' rejection is deliberately stricter and treats '\' as a separator
 * everywhere, matching getRelativeUri's containment check. Absolute locations
 * that miss the string prefix go through listingRelativePath, which applies
 * the same rules, so a literal backslash survives that route unchanged too.
 */
export function relativeLogPath(
  logDir: string,
  location: string,
  platform: NodeJS.Platform = os.platform()
): string | null {
  const dirWithSlash = logDir.endsWith("/") ? logDir : `${logDir}/`;
  if (location.startsWith(dirWithSlash)) {
    const relative = location.slice(dirWithSlash.length);
    return hasIrregularSegments(relative, isFileLocation(logDir), platform)
      ? null
      : relative;
  }
  try {
    if (isUri(location) || path.isAbsolute(location)) {
      // Absolute/URI locations (a plain path against a file: dir, or spelled
      // with different percent-encoding): contained iff listingRelativePath
      // says so. It returns the location's own segments, so a name it accepts
      // is the exact object that was listed; anything outside the dir,
      // including '..' escapes, comes back null and is dropped.
      return listingRelativePath(
        resolveToUri(logDir),
        resolveToUri(location),
        platform
      );
    }
  } catch {
    // unparseable dir or location — treat as outside the log dir
    return null;
  }
  // Otherwise the server returned a name already relative to the log dir; keep
  // it unless it uses '..' to climb out or has '.'/empty segments.
  return hasIrregularSegments(location, isFileLocation(logDir), platform)
    ? null
    : location;
}

/**
 * Whether a log dir names a file location (a plain path or a file: URI) rather
 * than a remote store, for choosing the path separators Uri.joinPath applies.
 */
function isFileLocation(logDir: string): boolean {
  return !isUri(logDir) || /^file:/i.test(logDir);
}

/**
 * Whether a log-dir-relative name contains a '..' (escape), '.' or empty
 * segment — the segments Uri.joinPath resolves away (see relativeLogPath).
 *
 * '..' is checked on both separators regardless of scheme: it is the traversal
 * defense and stays as strict as getRelativeUri. '.'/empty segments are only
 * what joinPath would actually fold, so '\' counts as a separator there only
 * for a file location on Windows; elsewhere it is a literal character.
 */
function hasIrregularSegments(
  relative: string,
  fileLocation: boolean,
  platform: NodeJS.Platform
): boolean {
  if (relative.split(/[\\/]/).includes("..")) {
    return true;
  }
  const separators = fileLocation && platform === "win32" ? /[\\/]/ : "/";
  return relative
    .split(separators)
    .some((segment) => segment === "" || segment === ".");
}

/**
 * Listing-local containment: the log-dir-relative name of `target`, or null
 * if it is not a strict descendant of `logDir`.
 *
 * This is the containment rule for tree nodes and their URIs, and it uses the
 * same separators as Uri.joinPath (see hasIrregularSegments): '/' always, and
 * '\' only for a file location on Windows. The shared getRelativeUri folds
 * every '\' to '/' before normalizing, which is right for the panels that
 * check Windows file paths but wrong for the identity of an S3 key or a POSIX
 * file name — under that folding a directory literally named '\.' compares
 * equal to the log dir itself and a name like 'team/\x.eval' is renamed to
 * 'team/x.eval', another object. Here the target's raw segments are kept and
 * compared against the normalized log dir path, so a name is accepted only
 * when it is already in canonical form for its scheme/platform and is then
 * returned exactly as listed.
 *
 * Traversal protection is unchanged: scheme and authority must match, the
 * target must sit under the log dir's '/'-terminated path, and the '..'
 * rejection in hasIrregularSegments applies on either separator for every
 * scheme.
 */
export function listingRelativePath(
  logDir: Uri,
  target: Uri,
  platform: NodeJS.Platform = os.platform()
): string | null {
  if (logDir.scheme !== target.scheme) {
    return null;
  }
  if (logDir.authority !== target.authority) {
    return null;
  }
  const fileLocation = logDir.scheme === "file";
  const windowsFile = fileLocation && platform === "win32";
  // Uri.joinPath resolves both separators for a Windows file location and
  // Uri.file spells the result with '/', so compare in that spelling there.
  const fold = (p: string) => (windowsFile ? p.replace(/\\/g, "/") : p);
  const parentPath = path.posix.normalize(fold(logDir.path));
  const parentBase = parentPath.endsWith("/")
    ? parentPath.slice(0, -1)
    : parentPath;
  const prefix = `${parentBase}/`;
  const targetPath = fold(target.path);
  if (!targetPath.startsWith(prefix)) {
    return null;
  }
  const relative = targetPath.slice(prefix.length);
  // A '.'/empty/'..' segment in the relative part means the target is not in
  // canonical form: it is either an escape or an alias of another entry
  // (Uri.joinPath would fold it), so it cannot be a node of its own.
  if (hasIrregularSegments(relative, fileLocation, platform)) {
    return null;
  }
  return relative;
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
    const uri = Uri.joinPath(this.logDir_, node.name);
    // Node names are containment-checked on ingest (see listLogs), so this
    // should always hold; verify defensively and never hand back a URI that
    // escapes the log directory (clamp to the log dir if it somehow does).
    // The check uses the listing's own separator rules so that a directory
    // whose literal name folds to '.' (e.g. '\.' in an S3 key) is not
    // mistaken for the log dir and clamped onto its id.
    if (
      uri.toString() !== this.logDir_.toString() &&
      listingRelativePath(this.logDir_, uri) === null
    ) {
      log.error(
        `Log node "${node.name}" resolved outside the log directory; refusing.`
      );
      return this.logDir_;
    }
    return uri;
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
        const log_dir = normalizeWindowsUri(logs.log_dir);
        const items: LogItem[] = [];
        let dropped = 0;
        for (const file of logs.items) {
          const relative = relativeLogPath(
            log_dir,
            normalizeWindowsUri(file.name)
          );
          // Drop listing entries that resolve outside the log directory
          // (e.g. remote-storage names containing '..' traversal) or whose
          // '.'/empty segments would collide with another entry's tree id,
          // rather than surfacing a misleading node in the tree.
          if (relative === null) {
            dropped++;
            continue;
          }
          file.name = relative;
          items.push(file);
        }
        if (dropped > 0) {
          log.warn(
            `Dropped ${dropped} log listing item(s) that resolved outside ${log_dir} or had '.'/empty path segments.`
          );
        }
        const tree = buildLogTree(items);
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

function deduplicateByName(logs: LogItem[]): LogItem[] {
  const seen = new Set<string>();
  return logs.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function buildLogTree(logs: LogItem[]): LogNode[] {
  // With S3 logs, we've see duplicates be returned, but we need each tree item
  // to be unique. This guarantees that.
  const dedupedLogs = deduplicateByName(logs);
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
  for (const log of dedupedLogs) {
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
        if (!parentDir.children.some((child) => child.name === currentPath)) {
          parentDir.children.push(currentParent);
        }
      } else if (!root.some((node) => node.name === currentPath)) {
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
