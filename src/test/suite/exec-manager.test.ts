/**
 * Tests for exec-manager.ts - ExecManager
 */
import * as assert from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  buildRunCommand,
  ExecProfile,
  terminalShellKind,
} from "../../core/package/exec-manager";
import { AbsolutePath, toAbsolutePath } from "../../core/path";
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
        binPath: () => ({ path: "/usr/bin/inspect" }) as AbsolutePath,
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
        binPath: () => ({ path: "/usr/bin/scout" }) as AbsolutePath,
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
        binPath: () => null,
        execArgs: () => [],
      };

      assert.strictEqual(profile.packageVersion, null);
      assert.strictEqual(profile.binPath(), null);
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

      const inspectTerminal = terminals.find((t) => t.name === "Inspect Eval");
      assert.ok(inspectTerminal);
      assert.strictEqual(inspectTerminal.name, "Inspect Eval");
    });

    test("should not find terminal if not exists", () => {
      const terminals = [{ name: "zsh" }, { name: "bash" }];

      const inspectTerminal = terminals.find((t) => t.name === "Inspect Eval");
      assert.strictEqual(inspectTerminal, undefined);
    });
  });

  suite("buildRunCommand (real command construction)", () => {
    const profile = (overrides: Partial<ExecProfile> = {}): ExecProfile => ({
      packageName: "inspect-ai",
      packageDisplayName: "Inspect",
      packageVersion: createMockVersion(
        "0.4.0"
      ) as unknown as ExecProfile["packageVersion"],
      target: "Eval",
      terminal: "Inspect Eval",
      command: "inspect",
      subcommand: "eval",
      binPath: () => null,
      execArgs: () => [],
      ...overrides,
    });

    test("runs the selected environment's console script by absolute path", () => {
      const { command, args } = buildRunCommand(
        profile({
          binPath: () => ({ path: "/my env/bin/inspect" }) as AbsolutePath,
        }),
        ["eval", "task.py@my_task"]
      );

      assert.strictEqual(command, "/my env/bin/inspect");
      assert.deepStrictEqual(args, ["eval", "task.py@my_task"]);
    });

    test("resolves the console script at Run time, not activation time", () => {
      let current: string | null = null;
      const p = profile({
        binPath: () => (current ? ({ path: current } as AbsolutePath) : null),
      });
      assert.strictEqual(buildRunCommand(p, ["eval"]).command, "inspect");
      current = "/other env/bin/inspect";
      assert.strictEqual(
        buildRunCommand(p, ["eval"]).command,
        "/other env/bin/inspect"
      );
    });

    test("falls back to the bare command when no console script is known", () => {
      const { command, args } = buildRunCommand(profile(), [
        "eval",
        "task.py@my_task",
      ]);

      assert.strictEqual(command, "inspect");
      assert.deepStrictEqual(args, ["eval", "task.py@my_task"]);
    });

    test("uses an approved subdirectory environment's own console script", () => {
      const root = mkdtempSync(join(tmpdir(), "inspect-env-"));
      try {
        const bin = join(
          root,
          process.platform === "win32" ? "Scripts" : "bin"
        );
        mkdirSync(bin);
        const python = toAbsolutePath(
          join(bin, process.platform === "win32" ? "python.exe" : "python")
        );
        writeFileSync(python.path, "");
        const scout = join(
          bin,
          process.platform === "win32" ? "scout.exe" : "scout"
        );
        writeFileSync(scout, "");

        const { command, args } = buildRunCommand(
          profile({ packageName: "inspect-scout", command: "scout" }),
          ["scan", "scan.py"],
          python
        );

        assert.strictEqual(command, scout);
        assert.deepStrictEqual(args, ["scan", "scan.py"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("falls back to `python -m <module>` when the environment has no console script", () => {
      const python = toAbsolutePath(
        process.platform === "win32"
          ? "C:\\missing\\Scripts\\python.exe"
          : "/missing/bin/python"
      );
      const { command, args } = buildRunCommand(
        profile(),
        ["eval", "task.py@my_task"],
        python
      );

      assert.strictEqual(command, python.path);
      // The importable module name, so Python reports the real problem.
      assert.deepStrictEqual(args, [
        "-m",
        "inspect_ai",
        "eval",
        "task.py@my_task",
      ]);
      assert.deepStrictEqual(
        buildRunCommand(
          profile({ packageName: "inspect-scout", command: "scout" }),
          ["scan"],
          python
        ).args,
        ["-m", "inspect_scout", "scan"]
      );
    });

    test("keeps a space-bearing target as a single argument", () => {
      const { args } = buildRunCommand(profile(), [
        "eval",
        "src/my tasks/task file.py@evaluate_model",
      ]);

      // The space-bearing target must remain ONE argument, not be split — it is
      // the caller's job to quote it before sending it to a shell.
      assert.deepStrictEqual(args, [
        "eval",
        "src/my tasks/task file.py@evaluate_model",
      ]);
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

suite("terminalShellKind", () => {
  const terminal = (
    shellPath?: string,
    reported?: string
  ): Parameters<typeof terminalShellKind>[0] => ({
    creationOptions: shellPath ? { shellPath } : {},
    state: { isInteractedWith: false, shell: reported } as unknown as {
      isInteractedWith: boolean;
    },
  });

  test("prefers the shell VS Code reports for the terminal", () => {
    assert.strictEqual(
      terminalShellKind(
        terminal("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "gitbash"),
        "cmd.exe",
        "win32"
      ),
      "posix"
    );
  });

  test("then the executable the terminal was created with", () => {
    assert.strictEqual(
      terminalShellKind(
        terminal("/opt/homebrew/bin/fish"),
        "/bin/zsh",
        "darwin"
      ),
      "fish"
    );
  });

  test("then the default shell VS Code launches for new terminals", () => {
    assert.strictEqual(
      terminalShellKind(terminal(), "/bin/zsh", "darwin"),
      "posix"
    );
    assert.strictEqual(
      terminalShellKind(terminal(), "C:\\Windows\\System32\\cmd.exe", "win32"),
      "cmd"
    );
  });

  test("and finally the platform default", () => {
    assert.strictEqual(
      terminalShellKind(terminal(), "", "win32"),
      "powershell"
    );
    assert.strictEqual(terminalShellKind(terminal(), "", "linux"), "posix");
    assert.strictEqual(
      terminalShellKind(terminal(undefined, "nu"), "", "darwin"),
      "posix"
    );
  });
});

suite("Run emits a readable command for the terminal's shell", () => {
  test("first and repeated Run, with and without shell integration", async function () {
    this.timeout(20000);
    const vscode = await import("vscode");
    const { runCommand } = await import("../../core/package/exec-manager");
    const originals = new Map<string, PropertyDescriptor>();
    const replace = (name: string, value: unknown) => {
      originals.set(
        name,
        Object.getOwnPropertyDescriptor(vscode.window, name)!
      );
      Object.defineProperty(vscode.window, name, { configurable: true, value });
    };
    const emitted: string[] = [];
    const terminal = {
      name: "Inspect Eval",
      // Exactly the identity available on the supported VS Code 1.93 host.
      state: { isInteractedWith: false },
      creationOptions: { shellPath: "/bin/zsh" },
      shellIntegration: undefined as
        undefined | { executeCommand: (line: string) => void },
      show: () => {},
      sendText: (line: string) => emitted.push(line),
    };
    const cases = [
      {
        shellPath: "/bin/zsh",
        binPath: "/selected env/bin/inspect",
        cwd: "/work space",
        command:
          "'/selected env/bin/inspect' eval 'tasks (1)/it'\\''s demo.py@demo' --limit 5",
        cd: "cd '/work space'",
      },
      {
        shellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        binPath: "C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe",
        cwd: "D:\\work space",
        command:
          "& 'C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe' eval 'tasks (1)/it''s demo.py@demo' --limit 5",
        cd: "cd -LiteralPath 'D:\\work space'",
      },
      {
        shellPath: "C:\\Windows\\System32\\cmd.exe",
        binPath: "C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe",
        cwd: "D:\\work space",
        command:
          '"C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe" eval "tasks (1)/it\'s demo.py@demo" --limit 5',
        cd: 'cd /d "D:\\work space"',
      },
    ];
    try {
      replace("createTerminal", () => terminal);
      replace("terminals", []);
      // Exercise the no-integration callback without waiting 10 seconds per test.
      replace(
        "onDidChangeTerminalShellIntegration",
        (callback: (e: unknown) => void) => {
          queueMicrotask(() =>
            callback({ terminal, shellIntegration: undefined })
          );
          return { dispose: () => {} };
        }
      );
      for (const testCase of cases) {
        terminal.creationOptions = { shellPath: testCase.shellPath };
        const profile = {
          packageName: "inspect-ai",
          command: "inspect",
          target: "Eval",
          terminal: "Inspect Eval",
          binPath: () => ({ path: testCase.binPath }) as AbsolutePath,
        } as ExecProfile;
        // Shell integration is the normal path; the sendText fallback (no
        // integration, reused terminal) must emit exactly the same text.
        for (const [integration, reused] of [
          [true, false],
          [true, true],
          [false, true],
        ]) {
          terminal.shellIntegration = integration
            ? { executeCommand: (line: string) => emitted.push(line) }
            : undefined;
          Object.defineProperty(vscode.window, "terminals", {
            configurable: true,
            value: reused ? [terminal] : [],
          });
          emitted.length = 0;
          await runCommand(
            profile,
            ["eval", "tasks (1)/it's demo.py@demo", "--limit", "5"],
            testCase.cwd
          );
          assert.deepStrictEqual(
            emitted,
            reused ? [testCase.cd, testCase.command] : [testCase.command],
            `${testCase.shellPath} integration=${integration} reused=${reused}`
          );
        }
      }
    } finally {
      for (const [name, descriptor] of originals) {
        Object.defineProperty(vscode.window, name, descriptor);
      }
    }
  });
});
