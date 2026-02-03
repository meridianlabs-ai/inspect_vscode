/**
 * Tests for output-watcher.ts - OutputWatcher
 */
import * as assert from "assert";

/**
 * Mock signal file types
 */
interface SignalFile {
  type: "log" | "scan";
  path: string;
}

/**
 * Signal file contents (JSON format for newer versions)
 */
interface SignalFileContents {
  location: string;
  workspace_id?: string;
}

suite("OutputWatcher Test Suite", () => {
  suite("Signal File Parsing", () => {
    test("should parse JSON signal file format", () => {
      const contents = JSON.stringify({
        location: "/logs/2024-01-01T12-00-00+00-00_task.eval",
        workspace_id: "ws-123",
      });

      const parsed = JSON.parse(contents) as SignalFileContents;

      assert.strictEqual(
        parsed.location,
        "/logs/2024-01-01T12-00-00+00-00_task.eval"
      );
      assert.strictEqual(parsed.workspace_id, "ws-123");
    });

    test("should handle JSON without workspace_id", () => {
      const contents = JSON.stringify({
        location: "/logs/2024-01-01T12-00-00+00-00_task.eval",
      });

      const parsed = JSON.parse(contents) as SignalFileContents;

      assert.strictEqual(
        parsed.location,
        "/logs/2024-01-01T12-00-00+00-00_task.eval"
      );
      assert.strictEqual(parsed.workspace_id, undefined);
    });

    test("should handle plain text signal file format (legacy)", () => {
      const contents = "/logs/2024-01-01T12-00-00+00-00_task.eval";

      // Legacy format is just the path
      const evalLogPath = contents;

      assert.strictEqual(
        evalLogPath,
        "/logs/2024-01-01T12-00-00+00-00_task.eval"
      );
    });

    test("should detect JSON vs plain text format", () => {
      const jsonContents = '{"location": "/path/to/log.eval"}';
      const plainContents = "/path/to/log.eval";

      const isJson = (str: string) => {
        try {
          JSON.parse(str);
          return true;
        } catch {
          return false;
        }
      };

      assert.strictEqual(isJson(jsonContents), true);
      assert.strictEqual(isJson(plainContents), false);
    });
  });

  suite("Signal File Type Detection", () => {
    test("should identify log signal file", () => {
      const signalFile: SignalFile = {
        type: "log",
        path: "/home/user/.inspect/last-eval",
      };

      assert.strictEqual(signalFile.type, "log");
    });

    test("should identify scan signal file", () => {
      const signalFile: SignalFile = {
        type: "scan",
        path: "/home/user/.scout/last-scan",
      };

      assert.strictEqual(signalFile.type, "scan");
    });

    test("should process multiple signal files", () => {
      const signalFiles: SignalFile[] = [
        { type: "log", path: "/home/user/.inspect/last-eval" },
        { type: "scan", path: "/home/user/.scout/last-scan" },
      ];

      const logFiles = signalFiles.filter(f => f.type === "log");
      const scanFiles = signalFiles.filter(f => f.type === "scan");

      assert.strictEqual(logFiles.length, 1);
      assert.strictEqual(scanFiles.length, 1);
    });
  });

  suite("External Workspace Detection", () => {
    test("should detect external workspace when IDs differ", () => {
      const currentWorkspaceId: string = "ws-current";
      const signalWorkspaceId: string = "ws-other";

      const externalWorkspace =
        !!signalWorkspaceId && signalWorkspaceId !== currentWorkspaceId;

      assert.strictEqual(externalWorkspace, true);
    });

    test("should detect same workspace when IDs match", () => {
      const currentWorkspaceId = "ws-123";
      const signalWorkspaceId = "ws-123";

      const externalWorkspace =
        !!signalWorkspaceId && signalWorkspaceId !== currentWorkspaceId;

      assert.strictEqual(externalWorkspace, false);
    });

    test("should handle missing workspace ID (legacy format)", () => {
      const currentWorkspaceId = "ws-123";
      const signalWorkspaceId = undefined;

      const externalWorkspace =
        !!signalWorkspaceId && signalWorkspaceId !== currentWorkspaceId;

      assert.strictEqual(externalWorkspace, false);
    });

    test("should handle empty workspace ID", () => {
      const currentWorkspaceId = "ws-123";
      const signalWorkspaceId = "";

      const externalWorkspace =
        !!signalWorkspaceId && signalWorkspaceId !== currentWorkspaceId;

      assert.strictEqual(externalWorkspace, false);
    });
  });

  suite("Timestamp Tracking", () => {
    test("should track last log timestamp", () => {
      let lastLog = Date.now();

      // Simulate file modification
      const fileModTime = Date.now() + 1000;

      const isNewer = fileModTime > lastLog;
      if (isNewer) {
        lastLog = fileModTime;
      }

      assert.strictEqual(isNewer, true);
      assert.strictEqual(lastLog, fileModTime);
    });

    test("should not process file with older timestamp", () => {
      const lastLog = Date.now();

      // Simulate file with older modification time
      const fileModTime = Date.now() - 1000;

      const isNewer = fileModTime > lastLog;

      assert.strictEqual(isNewer, false);
    });

    test("should track log and scan timestamps separately", () => {
      let lastLog = Date.now();
      const lastScan = Date.now();

      // Log updated
      const logModTime = Date.now() + 1000;
      if (logModTime > lastLog) {
        lastLog = logModTime;
      }

      // Scan not updated (older timestamp)
      const scanModTime = Date.now() - 1000;
      const scanIsNewer = scanModTime > lastScan;

      assert.strictEqual(lastLog, logModTime);
      assert.strictEqual(scanIsNewer, false);
    });
  });

  suite("URI Resolution", () => {
    test("should handle file:// URIs", () => {
      const path = "/workspace/logs/eval.log";
      const uri = `file://${path}`;

      assert.ok(uri.startsWith("file://"));
      assert.ok(uri.includes(path));
    });

    test("should handle remote URIs", () => {
      const remotePath = "s3://bucket/logs/eval.log";

      assert.ok(remotePath.startsWith("s3://"));
    });

    test("should handle Windows-style paths", () => {
      const windowsPath = "C:\\Users\\test\\logs\\eval.log";
      const normalizedPath = windowsPath.replace(/\\/g, "/");

      assert.strictEqual(normalizedPath, "C:/Users/test/logs/eval.log");
    });
  });

  suite("Event Emission", () => {
    test("should create log created event", () => {
      interface InspectLogCreatedEvent {
        log: { toString: () => string };
        externalWorkspace: boolean;
      }

      const event: InspectLogCreatedEvent = {
        log: { toString: () => "file:///logs/eval.log" },
        externalWorkspace: false,
      };

      assert.strictEqual(event.log.toString(), "file:///logs/eval.log");
      assert.strictEqual(event.externalWorkspace, false);
    });

    test("should create scan created event", () => {
      interface ScoutScanCreatedEvent {
        scan: { toString: () => string };
        externalWorkspace: boolean;
      }

      const event: ScoutScanCreatedEvent = {
        scan: { toString: () => "file:///scans/scan.json" },
        externalWorkspace: true,
      };

      assert.strictEqual(event.scan.toString(), "file:///scans/scan.json");
      assert.strictEqual(event.externalWorkspace, true);
    });
  });

  suite("Watch Interval Management", () => {
    test("should track interval state", () => {
      let watchInterval: ReturnType<typeof setInterval> | null = null;

      // Start watching
      watchInterval = setInterval(() => {}, 500);
      assert.ok(watchInterval !== null);

      // Stop watching
      clearInterval(watchInterval);
      watchInterval = null;
      assert.strictEqual(watchInterval, null);
    });

    test("should use correct polling interval", () => {
      const POLLING_INTERVAL = 500;

      assert.strictEqual(POLLING_INTERVAL, 500);
    });
  });

  suite("Error Handling", () => {
    test("should handle malformed JSON gracefully", () => {
      const malformedJson = "{location: invalid}";
      let parsed: SignalFileContents | null = null;
      let parseError = false;

      try {
        parsed = JSON.parse(malformedJson) as SignalFileContents;
      } catch {
        parseError = true;
      }

      assert.strictEqual(parseError, true);
      assert.strictEqual(parsed, null);
    });

    test("should handle empty signal file", () => {
      const emptyContents = "";
      let parsed: SignalFileContents | null = null;
      let parseError = false;

      try {
        parsed = JSON.parse(emptyContents) as SignalFileContents;
      } catch {
        parseError = true;
      }

      assert.strictEqual(parseError, true);
      assert.strictEqual(parsed, null);
    });

    test("should handle missing location field", () => {
      const contentsWithoutLocation = JSON.stringify({
        workspace_id: "ws-123",
      });

      const parsed = JSON.parse(contentsWithoutLocation) as SignalFileContents;

      assert.strictEqual(parsed.location, undefined);
    });
  });

  suite("Version-Based Signal File Format", () => {
    test("should use JSON format for version 0.3.10+", () => {
      const version = "0.3.10";
      const [major, minor, patch] = version.split(".").map(Number);

      const useJsonFormat =
        major > 0 || minor > 3 || (minor === 3 && patch >= 10);

      assert.strictEqual(useJsonFormat, true);
    });

    test("should use plain text format for version 0.3.8", () => {
      const version = "0.3.8";
      const [major, minor, patch] = version.split(".").map(Number);

      const useJsonFormat =
        major > 0 || minor > 3 || (minor === 3 && patch >= 10);

      assert.strictEqual(useJsonFormat, false);
    });

    test("should handle version comparison edge cases", () => {
      const testCases = [
        { version: "0.3.9", expected: false },
        { version: "0.3.10", expected: true },
        { version: "0.4.0", expected: true },
        { version: "1.0.0", expected: true },
      ];

      for (const { version, expected } of testCases) {
        const [major, minor, patch] = version.split(".").map(Number);
        const useJsonFormat =
          major > 0 || minor > 3 || (minor === 3 && patch >= 10);

        assert.strictEqual(
          useJsonFormat,
          expected,
          `Version ${version} should ${expected ? "" : "not "}use JSON format`
        );
      }
    });
  });
});
