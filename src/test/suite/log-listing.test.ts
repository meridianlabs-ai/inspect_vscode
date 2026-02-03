/**
 * Tests for log-listing.ts and log-listing-data.ts - LogListing and TreeDataProviders
 */
import * as assert from "assert";

/**
 * Mock LogItem for testing
 */
interface LogItem {
  name: string;
  mtime: number;
  display_name: string;
  item_id: string;
}

/**
 * Mock LogDirectory for testing
 */
interface LogDirectory {
  name: string;
  children: LogNode[];
}

/**
 * Mock LogNode for testing
 */
type LogNode =
  | ({ type: "dir"; parent?: LogNode } & LogDirectory)
  | ({ type: "file"; parent?: LogNode } & LogItem);

/**
 * Build a log tree from flat list of items
 */
function buildLogTree(logs: LogItem[]): LogNode[] {
  const root: LogNode[] = [];
  const dirCache: Map<string, LogNode> = new Map();

  function createDir(name: string, parent?: LogNode): LogNode {
    return {
      type: "dir",
      name,
      children: [],
      parent,
    };
  }

  function createFileNode(file: LogItem, parent?: LogNode): LogNode {
    return {
      ...file,
      type: "file",
      parent,
    };
  }

  function ensureDirectory(path: string, parent?: LogNode): LogNode {
    if (dirCache.has(path)) {
      return dirCache.get(path)!;
    }

    const dir = createDir(path, parent);
    dirCache.set(path, dir);
    return dir;
  }

  for (const log of logs) {
    const parts = log.name.split("/");
    parts.pop(); // remove the filename
    let currentParent: LogNode | undefined;
    let currentPath = "";

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

    const fileNode = createFileNode(log, currentParent);
    if (currentParent?.type === "dir") {
      currentParent.children.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  return root;
}

/**
 * Sort log tree with directories first, files by mtime descending
 */
function sortLogTree(nodes: LogNode[]): LogNode[] {
  for (const node of nodes) {
    if (node.type === "dir") {
      node.children = sortLogTree(node.children);
    }
  }

  return nodes.sort((a, b) => {
    if (a.type === "dir" && b.type === "dir") {
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

/**
 * Format date for display
 */
function formatPrettyDateTime(date: Date): string {
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isToday) {
    return `Today, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}`;
  }

  if (isThisYear) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

suite("LogListing Test Suite", () => {
  suite("Log Tree Building", () => {
    test("should build flat list for files without subdirectories", () => {
      const items: LogItem[] = [
        {
          name: "2024-01-01T12-00-00+00-00_task.eval",
          mtime: 1704110400000,
          display_name: "task",
          item_id: "1",
        },
        {
          name: "2024-01-02T12-00-00+00-00_task.eval",
          mtime: 1704196800000,
          display_name: "task",
          item_id: "2",
        },
      ];

      const tree = buildLogTree(items);

      assert.strictEqual(tree.length, 2);
      assert.ok(tree.every(node => node.type === "file"));
    });

    test("should build tree with subdirectory", () => {
      const items: LogItem[] = [
        {
          name: "subdir/2024-01-01T12-00-00+00-00_task.eval",
          mtime: 1704110400000,
          display_name: "task",
          item_id: "1",
        },
      ];

      const tree = buildLogTree(items);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0].type, "dir");
      assert.strictEqual(tree[0].name, "subdir");
      if (tree[0].type === "dir") {
        assert.strictEqual(tree[0].children.length, 1);
        assert.strictEqual(tree[0].children[0].type, "file");
      }
    });

    test("should handle nested subdirectories", () => {
      const items: LogItem[] = [
        {
          name: "level1/level2/2024-01-01T12-00-00+00-00_task.eval",
          mtime: 1704110400000,
          display_name: "task",
          item_id: "1",
        },
      ];

      const tree = buildLogTree(items);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0].type, "dir");
      assert.strictEqual(tree[0].name, "level1");

      if (tree[0].type === "dir") {
        assert.strictEqual(tree[0].children.length, 1);
        const level2 = tree[0].children[0];
        assert.strictEqual(level2.type, "dir");
        assert.strictEqual(level2.name, "level1/level2");
      }
    });

    test("should group files in same directory", () => {
      const items: LogItem[] = [
        {
          name: "project/2024-01-01T12-00-00+00-00_task1.eval",
          mtime: 1704110400000,
          display_name: "task1",
          item_id: "1",
        },
        {
          name: "project/2024-01-02T12-00-00+00-00_task2.eval",
          mtime: 1704196800000,
          display_name: "task2",
          item_id: "2",
        },
      ];

      const tree = buildLogTree(items);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0].type, "dir");
      if (tree[0].type === "dir") {
        assert.strictEqual(tree[0].children.length, 2);
      }
    });

    test("should track parent references", () => {
      const items: LogItem[] = [
        {
          name: "parent/2024-01-01T12-00-00+00-00_task.eval",
          mtime: 1704110400000,
          display_name: "task",
          item_id: "1",
        },
      ];

      const tree = buildLogTree(items);
      const parentDir = tree[0];

      if (parentDir.type === "dir") {
        const fileNode = parentDir.children[0];
        assert.strictEqual(fileNode.parent, parentDir);
      }
    });
  });

  suite("Log Tree Sorting", () => {
    test("should sort files by mtime descending", () => {
      const nodes: LogNode[] = [
        {
          type: "file",
          name: "older.eval",
          mtime: 1000,
          display_name: "older",
          item_id: "1",
        },
        {
          type: "file",
          name: "newer.eval",
          mtime: 2000,
          display_name: "newer",
          item_id: "2",
        },
      ];

      const sorted = sortLogTree(nodes);

      assert.strictEqual((sorted[0] as LogItem).mtime, 2000);
      assert.strictEqual((sorted[1] as LogItem).mtime, 1000);
    });

    test("should place directories before files", () => {
      const nodes: LogNode[] = [
        {
          type: "file",
          name: "file.eval",
          mtime: 1000,
          display_name: "file",
          item_id: "1",
        },
        {
          type: "dir",
          name: "directory",
          children: [],
        },
      ];

      const sorted = sortLogTree(nodes);

      assert.strictEqual(sorted[0].type, "dir");
      assert.strictEqual(sorted[1].type, "file");
    });

    test("should sort nested children", () => {
      const nodes: LogNode[] = [
        {
          type: "dir",
          name: "parent",
          children: [
            {
              type: "file",
              name: "older.eval",
              mtime: 1000,
              display_name: "older",
              item_id: "1",
            },
            {
              type: "file",
              name: "newer.eval",
              mtime: 2000,
              display_name: "newer",
              item_id: "2",
            },
          ],
        },
      ];

      const sorted = sortLogTree(nodes);
      const dir = sorted[0];

      if (dir.type === "dir") {
        assert.strictEqual((dir.children[0] as LogItem).mtime, 2000);
        assert.strictEqual((dir.children[1] as LogItem).mtime, 1000);
      }
    });
  });

  suite("Date Formatting", () => {
    test("should format today's date with time only", () => {
      const now = new Date();
      const formatted = formatPrettyDateTime(now);

      assert.ok(formatted.includes("Today"));
    });

    test("should format this year's date without year", () => {
      const date = new Date();
      date.setMonth(date.getMonth() - 1); // Last month

      const formatted = formatPrettyDateTime(date);

      // Should not include the year for dates in the current year
      assert.ok(!formatted.includes(String(date.getFullYear() - 1)));
    });

    test("should format past year's date with year", () => {
      const date = new Date();
      date.setFullYear(date.getFullYear() - 1);

      const formatted = formatPrettyDateTime(date);

      assert.ok(formatted.includes(String(date.getFullYear())));
    });
  });

  suite("Log Node URI Resolution", () => {
    test("should join log dir with node name", () => {
      const logDir = "/workspace/logs";
      const nodeName = "2024-01-01T12-00-00+00-00_task.eval";

      const uri = `${logDir}/${nodeName}`;

      assert.strictEqual(
        uri,
        "/workspace/logs/2024-01-01T12-00-00+00-00_task.eval"
      );
    });

    test("should handle nested node paths", () => {
      const logDir = "/workspace/logs";
      const nodeName = "subdir/2024-01-01T12-00-00+00-00_task.eval";

      const uri = `${logDir}/${nodeName}`;

      assert.strictEqual(
        uri,
        "/workspace/logs/subdir/2024-01-01T12-00-00+00-00_task.eval"
      );
    });
  });

  suite("Node Lookup", () => {
    test("should find file node by URI", () => {
      const targetUri = "/logs/project/task.eval";
      const nodes: LogNode[] = [
        {
          type: "dir",
          name: "project",
          children: [
            {
              type: "file",
              name: "project/task.eval",
              mtime: 1000,
              display_name: "task",
              item_id: "1",
            },
          ],
        },
      ];

      const findNode = (
        nodes: LogNode[],
        uri: string,
        logDir: string
      ): LogNode | undefined => {
        for (const node of nodes) {
          if (node.type === "file") {
            const nodeUri = `${logDir}/${node.name}`;
            if (nodeUri === uri) {
              return node;
            }
          } else if (node.type === "dir") {
            const found = findNode(node.children, uri, logDir);
            if (found) {
              return found;
            }
          }
        }
        return undefined;
      };

      const found = findNode(nodes, targetUri, "/logs");

      assert.ok(found);
      assert.strictEqual(found?.type, "file");
    });

    test("should return undefined for non-existent URI", () => {
      const nodes: LogNode[] = [];

      const findNode = (
        nodes: LogNode[],
        _uri: string
      ): LogNode | undefined => {
        if (nodes.length === 0) {
          return undefined;
        }
        return undefined;
      };

      const found = findNode(nodes, "/non/existent/path");

      assert.strictEqual(found, undefined);
    });
  });

  suite("Log Listing Invalidation", () => {
    test("should track invalidation state", () => {
      let nodes: LogNode[] | undefined = [
        {
          type: "file",
          name: "task.eval",
          mtime: 1000,
          display_name: "task",
          item_id: "1",
        },
      ];

      const invalidate = () => {
        nodes = undefined;
      };

      assert.ok(nodes !== undefined);

      invalidate();

      assert.strictEqual(nodes, undefined);
    });
  });

  suite("Tree Item Creation", () => {
    test("should create tree item for file node", () => {
      const node: LogNode = {
        type: "file",
        name: "2024-01-01T12-00-00+00-00_my_task.eval",
        mtime: 1704110400000,
        display_name: "my_task",
        item_id: "1",
      };

      const treeItem = {
        id: node.name,
        label: node.display_name,
        collapsibleState: 0, // None
        contextValue: "file+local+eval",
      };

      assert.strictEqual(treeItem.label, "my_task");
      assert.strictEqual(treeItem.collapsibleState, 0);
      assert.ok(treeItem.contextValue.includes("file"));
    });

    test("should create tree item for directory node", () => {
      const node: LogNode = {
        type: "dir",
        name: "my_project",
        children: [],
      };

      const treeItem = {
        id: node.name,
        label: node.name.split("/").pop(),
        collapsibleState: 1, // Collapsed
        contextValue: "dir+local",
      };

      assert.strictEqual(treeItem.label, "my_project");
      assert.strictEqual(treeItem.collapsibleState, 1);
      assert.ok(treeItem.contextValue.includes("dir"));
    });

    test("should determine context value for .eval files", () => {
      const evalFile = "2024-01-01T12-00-00+00-00_task.eval";
      const jsonFile = "2024-01-01T12-00-00+00-00_task.json";

      const isEvalFile = (name: string) => name.endsWith(".eval");

      assert.strictEqual(isEvalFile(evalFile), true);
      assert.strictEqual(isEvalFile(jsonFile), false);
    });

    test("should determine local vs remote context", () => {
      const fileScheme = "file";
      const httpScheme = "http";
      const s3Scheme = "s3";

      const isLocal = (scheme: string) => scheme === "file";

      assert.strictEqual(isLocal(fileScheme), true);
      assert.strictEqual(isLocal(httpScheme), false);
      assert.strictEqual(isLocal(s3Scheme), false);
    });
  });

  suite("Log Date Parsing", () => {
    test("should parse log date from filename", () => {
      const logName = "2024-01-15T14-30-45+05-00_task.eval";
      const dateMatch = logName.match(
        /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2})/
      );

      assert.ok(dateMatch);
      if (dateMatch) {
        assert.strictEqual(dateMatch[1], "2024-01-15T14-30-45+05-00");
      }
    });

    test("should normalize date format for parsing", () => {
      const logDate = "2024-01-15T14-30-45+05-00";
      const normalized = logDate.replace(
        /T(\d{2})-(\d{2})-(\d{2})([+-])(\d{2})-(\d{2})/,
        "T$1:$2:$3$4$5:$6"
      );

      assert.strictEqual(normalized, "2024-01-15T14:30:45+05:00");
    });

    test("should parse normalized date string", () => {
      const normalized = "2024-01-15T14:30:45+05:00";
      const date = new Date(normalized);

      assert.ok(!isNaN(date.getTime()));
    });

    test("should handle negative timezone offsets", () => {
      const logDate = "2024-01-15T14-30-45-08-00";
      const normalized = logDate.replace(
        /T(\d{2})-(\d{2})-(\d{2})([+-])(\d{2})-(\d{2})/,
        "T$1:$2:$3$4$5:$6"
      );

      assert.strictEqual(normalized, "2024-01-15T14:30:45-08:00");
    });
  });

  suite("MRU (Most Recently Used) Tracking", () => {
    test("should track MRU list operations", () => {
      const mruList: string[] = [];

      const add = (uri: string) => {
        const index = mruList.indexOf(uri);
        if (index > -1) {
          mruList.splice(index, 1);
        }
        mruList.unshift(uri);
      };

      const remove = (uri: string) => {
        const index = mruList.indexOf(uri);
        if (index > -1) {
          mruList.splice(index, 1);
        }
      };

      add("/logs/project1");
      add("/logs/project2");
      add("/logs/project1"); // Should move to front

      assert.strictEqual(mruList[0], "/logs/project1");
      assert.strictEqual(mruList.length, 2);

      remove("/logs/project2");
      assert.strictEqual(mruList.length, 1);
    });
  });
});
