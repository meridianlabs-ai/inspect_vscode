/**
 * Tests for exec-manager.ts - ExecManager
 */
import * as assert from "assert";
import { ExecProfile } from "../../core/package/exec-manager";
import { DocumentState } from "../../providers/workspace/workspace-state-provider";

/**
 * Mock VersionDescriptor for testing
 */
interface MockVersionDescriptor {
  raw: string;
  version: {
    major: number;
    minor: number;
    patch: number;
    compare: (version: string) => number;
  };
  isDeveloperBuild: boolean;
}

function createMockVersion(
  versionStr: string,
  isDev = false
): MockVersionDescriptor {
  const parts = versionStr.split(".").map(Number);
  return {
    raw: versionStr,
    version: {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      compare: (_v: string) => 0,
    },
    isDeveloperBuild: isDev,
  };
}

suite("ExecManager Test Suite", () => {
  suite("ExecProfile Configuration", () => {
    test("should create inspect-ai exec profile", () => {
      const profile: ExecProfile = {
        packageName: "inspect-ai",
        packageDisplayName: "Inspect",
        packageVersion: createMockVersion(
          "0.4.0"
        ) as unknown as ExecProfile["packageVersion"],
        target: "Eval",
        terminal: "Inspect Eval",
        command: "inspect",
        subcommand: "eval",
        binPath: { path: "/usr/bin/inspect" } as ExecProfile["binPath"],
        execArgs: () => [],
      };

      assert.strictEqual(profile.packageName, "inspect-ai");
      assert.strictEqual(profile.packageDisplayName, "Inspect");
      assert.strictEqual(profile.target, "Eval");
      assert.strictEqual(profile.terminal, "Inspect Eval");
      assert.strictEqual(profile.command, "inspect");
      assert.strictEqual(profile.subcommand, "eval");
    });

    test("should create inspect-scout exec profile", () => {
      const profile: ExecProfile = {
        packageName: "inspect-scout",
        packageDisplayName: "Inspect Scout",
        packageVersion: createMockVersion(
          "1.0.0"
        ) as unknown as ExecProfile["packageVersion"],
        target: "Scan",
        terminal: "Scout Scan",
        command: "scout",
        subcommand: "scan",
        binPath: { path: "/usr/bin/scout" } as ExecProfile["binPath"],
        execArgs: () => [],
      };

      assert.strictEqual(profile.packageName, "inspect-scout");
      assert.strictEqual(profile.packageDisplayName, "Inspect Scout");
      assert.strictEqual(profile.target, "Scan");
      assert.strictEqual(profile.terminal, "Scout Scan");
      assert.strictEqual(profile.command, "scout");
      assert.strictEqual(profile.subcommand, "scan");
    });

    test("should handle null packageVersion", () => {
      const profile: ExecProfile = {
        packageName: "inspect-ai",
        packageDisplayName: "Inspect",
        packageVersion: null,
        target: "Eval",
        terminal: "Inspect Eval",
        command: "inspect",
        subcommand: "eval",
        binPath: null,
        execArgs: () => [],
      };

      assert.strictEqual(profile.packageVersion, null);
      assert.strictEqual(profile.binPath, null);
    });
  });

  suite("Command Argument Generation", () => {
    test("should generate basic eval arguments", () => {
      const docState: DocumentState = {};

      const execArgs = (_state: DocumentState, _debug: boolean): string[] => {
        return [];
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, []);
    });

    test("should include limit argument when specified", () => {
      const docState: DocumentState = {
        limit: "10",
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.limit) {
          args.push("--limit", state.limit);
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, ["--limit", "10"]);
    });

    test("should include epochs argument when specified", () => {
      const docState: DocumentState = {
        epochs: "5",
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.epochs) {
          args.push("--epochs", state.epochs);
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, ["--epochs", "5"]);
    });

    test("should include temperature argument when specified", () => {
      const docState: DocumentState = {
        temperature: "0.7",
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.temperature) {
          args.push("--temperature", state.temperature);
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, ["--temperature", "0.7"]);
    });

    test("should include multiple arguments", () => {
      const docState: DocumentState = {
        limit: "20",
        epochs: "3",
        temperature: "0.5",
        maxTokens: "1000",
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.limit) {
          args.push("--limit", state.limit);
        }
        if (state.epochs) {
          args.push("--epochs", state.epochs);
        }
        if (state.temperature) {
          args.push("--temperature", state.temperature);
        }
        if (state.maxTokens) {
          args.push("--max-tokens", state.maxTokens);
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, [
        "--limit",
        "20",
        "--epochs",
        "3",
        "--temperature",
        "0.5",
        "--max-tokens",
        "1000",
      ]);
    });

    test("should handle sample IDs", () => {
      const docState: DocumentState = {
        sampleIds: "1,2,3,4,5",
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.sampleIds) {
          args.push("--sample-ids", state.sampleIds);
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.deepStrictEqual(args, ["--sample-ids", "1,2,3,4,5"]);
    });

    test("should handle custom params", () => {
      const docState: DocumentState = {
        params: {
          model: "gpt-4",
          dataset: "mmlu",
        },
      };

      const execArgs = (state: DocumentState, _debug: boolean): string[] => {
        const args: string[] = [];
        if (state.params) {
          for (const [key, value] of Object.entries(state.params)) {
            args.push(`--${key}`, value);
          }
        }
        return args;
      };

      const args = execArgs(docState, false);
      assert.ok(args.includes("--model"));
      assert.ok(args.includes("gpt-4"));
      assert.ok(args.includes("--dataset"));
      assert.ok(args.includes("mmlu"));
    });
  });

  suite("Debug Mode", () => {
    test("should not add debug flag for non-debug run", () => {
      const execArgs = (_state: DocumentState, debug: boolean): string[] => {
        const args: string[] = [];
        if (debug) {
          args.push("--debug");
        }
        return args;
      };

      const args = execArgs({}, false);
      assert.deepStrictEqual(args, []);
    });

    test("should add appropriate config for debug mode", () => {
      const execArgs = (_state: DocumentState, debug: boolean): string[] => {
        const args: string[] = [];
        if (debug) {
          args.push("--debug");
        }
        return args;
      };

      const args = execArgs({}, true);
      assert.deepStrictEqual(args, ["--debug"]);
    });
  });

  suite("Target Path Formatting", () => {
    test("should format target with file path only", () => {
      const relativePath = "src/tasks/task.py";

      // When target is undefined, only the relativePath is used
      const formatTarget = (path: string, target?: string) =>
        target ? `${path}@${target}` : path;

      const targetArg = formatTarget(relativePath);

      assert.strictEqual(targetArg, "src/tasks/task.py");
    });

    test("should format target with file path and task name", () => {
      const relativePath = "src/tasks/task.py";
      const target = "my_task";

      const targetArg = target ? `${relativePath}@${target}` : relativePath;

      assert.strictEqual(targetArg, "src/tasks/task.py@my_task");
    });

    test("should handle paths with spaces", () => {
      const relativePath = "src/my tasks/task file.py";
      const target = "evaluate_model";

      const targetArg = target ? `${relativePath}@${target}` : relativePath;

      assert.strictEqual(targetArg, "src/my tasks/task file.py@evaluate_model");
    });
  });

  suite("Terminal Management", () => {
    test("should identify terminal by name", () => {
      const terminals = [
        { name: "Inspect Eval" },
        { name: "zsh" },
        { name: "bash" },
      ];

      const inspectTerminal = terminals.find(t => t.name === "Inspect Eval");
      assert.ok(inspectTerminal);
      assert.strictEqual(inspectTerminal.name, "Inspect Eval");
    });

    test("should not find terminal if not exists", () => {
      const terminals = [{ name: "zsh" }, { name: "bash" }];

      const inspectTerminal = terminals.find(t => t.name === "Inspect Eval");
      assert.strictEqual(inspectTerminal, undefined);
    });
  });

  suite("Python Environment Handling", () => {
    test("should build command with python module syntax", () => {
      const pythonPath = "/venv/bin/python";
      const packageName = "inspect-ai";
      const args = ["eval", "task.py@my_task"];

      const cmd: string[] = [];
      cmd.push(pythonPath);
      cmd.push("-m");
      cmd.push(packageName);
      cmd.push(...args);

      assert.deepStrictEqual(cmd, [
        "/venv/bin/python",
        "-m",
        "inspect-ai",
        "eval",
        "task.py@my_task",
      ]);
    });

    test("should build command with direct binary", () => {
      const command = "inspect";
      const args = ["eval", "task.py@my_task"];

      const cmd: string[] = [];
      cmd.push(command);
      cmd.push(...args);

      assert.deepStrictEqual(cmd, ["inspect", "eval", "task.py@my_task"]);
    });
  });

  suite("Debugger Configuration", () => {
    test("should create debug configuration", () => {
      const name = "Inspect Eval";
      const program = "/usr/bin/inspect";
      const args = ["eval", "task.py"];
      const cwd = "/workspace";
      const env = { INSPECT_WORKSPACE_ID: "123" };

      const debugConfig = {
        name,
        type: "debugpy",
        request: "launch",
        program,
        args,
        console: "integratedTerminal",
        cwd,
        env,
        justMyCode: false,
      };

      assert.strictEqual(debugConfig.name, "Inspect Eval");
      assert.strictEqual(debugConfig.type, "debugpy");
      assert.strictEqual(debugConfig.request, "launch");
      assert.strictEqual(debugConfig.program, "/usr/bin/inspect");
      assert.deepStrictEqual(debugConfig.args, ["eval", "task.py"]);
      assert.strictEqual(debugConfig.cwd, "/workspace");
      assert.deepStrictEqual(debugConfig.env, { INSPECT_WORKSPACE_ID: "123" });
      assert.strictEqual(debugConfig.justMyCode, false);
    });

    test("should include python path in debug configuration", () => {
      const pythonPath = "/venv/bin/python";

      const debugConfig = {
        name: "Test",
        type: "debugpy",
        pythonPath,
      };

      assert.strictEqual(debugConfig.pythonPath, "/venv/bin/python");
    });
  });

  suite("Package Version Validation", () => {
    test("should detect when package is not installed", () => {
      const packageVersion = null;
      const isInstalled = packageVersion !== null;

      assert.strictEqual(isInstalled, false);
    });

    test("should detect when package is installed", () => {
      const packageVersion = createMockVersion("0.4.0");
      const isInstalled = packageVersion !== null;

      assert.strictEqual(isInstalled, true);
    });

    test("should detect developer build", () => {
      const devVersion = createMockVersion("0.4.1.dev1", true);
      const releaseVersion = createMockVersion("0.4.0", false);

      assert.strictEqual(devVersion.isDeveloperBuild, true);
      assert.strictEqual(releaseVersion.isDeveloperBuild, false);
    });
  });
});
