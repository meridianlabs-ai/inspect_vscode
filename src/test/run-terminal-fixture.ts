import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { TerminalOptions, window } from "vscode";

import { ExecProfile, runCommand } from "../core/package/exec-manager";
import { AbsolutePath } from "../core/path";

/**
 * Run first and repeated Inspect and Scout tasks through a real integrated
 * terminal created with the host's default shell profile, the way users do.
 *
 * The "selected environment" is a directory holding an interpreter-style
 * console script beside `python`, as pip lays out `.venv/bin/inspect` or
 * `.venv\Scripts\inspect.exe`. The terminal's PATH puts a decoy `inspect` /
 * `scout` first and omits both the environment and the Python installation,
 * so the task only runs if the command names the environment's script by
 * absolute path. Paths and arguments carry spaces, parentheses and an
 * apostrophe, the characters real installs and file names have.
 */
export async function verifyRunTerminal(): Promise<void> {
  const windows = process.platform === "win32";
  const python = spawnSync(
    windows ? "python" : "python3",
    ["-c", "import sys;print(sys.executable)"],
    { encoding: "utf8" }
  ).stdout.trim();
  assert.ok(python, "a Python interpreter is required for this fixture");

  const root = mkdtempSync(join(tmpdir(), "inspect run (test) "));
  const cwd = join(root, "work space");
  mkdirSync(cwd);
  const envBin = join(root, "env", windows ? "Scripts" : "bin");
  mkdirSync(envBin, { recursive: true });
  const result = join(root, "result.json");
  writeFileSync(
    join(envBin, "console_script.py"),
    [
      "import json, os, sys",
      "target = os.environ['RUN_RESULT']",
      "with open(target + '.tmp', 'w', encoding='utf-8') as f:",
      "    json.dump({'command': sys.argv[1], 'args': sys.argv[2:], 'cwd': os.getcwd(), 'activation': os.environ.get('RUN_ACTIVATED')}, f)",
      "os.replace(target + '.tmp', target)",
      "print('fixture output')",
      "",
    ].join("\n")
  );
  const marker = join(root, "DECOY_RAN");
  const decoyDir = join(root, "decoys");
  mkdirSync(decoyDir);
  const scripts: Record<string, string> = {};
  for (const command of ["inspect", "scout"]) {
    if (windows) {
      // Batch files stand in for pip's .exe launchers; keep them ASCII, cmd
      // reads them in the OEM code page.
      scripts[command] = join(envBin, `${command}.cmd`);
      writeFileSync(
        scripts[command],
        `@"${python}" "%~dp0console_script.py" ${command} %*\r\n`
      );
      writeFileSync(
        join(decoyDir, `${command}.cmd`),
        `@echo decoy>"${marker}"\r\n@exit /b 23\r\n`
      );
    } else {
      scripts[command] = join(envBin, command);
      writeFileSync(
        scripts[command],
        `#!/bin/sh\nexec "${python}" "$(dirname "$0")/console_script.py" ${command} "$@"\n`
      );
      chmodSync(scripts[command], 0o755);
      const decoy = join(decoyDir, command);
      writeFileSync(decoy, `#!/bin/sh\nprintf decoy > "${marker}"\nexit 23\n`);
      chmodSync(decoy, 0o755);
    }
  }
  const pythonDir = resolve(dirname(python)).toLowerCase();
  const terminalPath = [
    decoyDir,
    ...(process.env.PATH || "").split(delimiter).filter((entry) => {
      const normalized = entry ? resolve(entry).toLowerCase() : "";
      return (
        normalized &&
        !normalized.startsWith(pythonDir) &&
        normalized !== resolve(envBin).toLowerCase()
      );
    }),
  ].join(delimiter);

  const original = Object.getOwnPropertyDescriptor(window, "createTerminal")!;
  const create = window.createTerminal;
  const terminals: ReturnType<typeof create>[] = [];
  let output = "";
  const running = new Set<(typeof terminals)[number]>();
  const outputListener = window.onDidStartTerminalShellExecution((event) => {
    if (terminals.includes(event.terminal)) {
      running.add(event.terminal);
      void (async () => {
        for await (const data of event.execution.read()) {
          output = (output + data).slice(-20000);
        }
      })()
        .catch((error: unknown) => {
          output += String(error);
        })
        .finally(() => {
          running.delete(event.terminal);
        });
    }
  });
  // The default profile is used, as in production; only the environment is
  // adjusted, standing in for the Python extension's activation variables.
  Object.defineProperty(window, "createTerminal", {
    configurable: true,
    value: (options: TerminalOptions) => {
      const terminal = create({
        ...options,
        env: {
          PATH: terminalPath,
          RUN_RESULT: result,
          RUN_ACTIVATED: "terminal-activation",
        },
      });
      terminals.push(terminal);
      return terminal;
    },
  });
  try {
    for (const command of ["inspect", "scout"] as const) {
      const profile = {
        packageName: command === "inspect" ? "inspect-ai" : "inspect-scout",
        command,
        terminal: command === "inspect" ? "Inspect Eval" : "Scout Scan",
        target: command === "inspect" ? "Eval" : "Scan",
        binPath: () => ({ path: scripts[command] }) as AbsolutePath,
      } as ExecProfile;
      for (const label of ["first", "repeated"]) {
        rmSync(result, { force: true });
        const args = [
          command === "inspect" ? "eval" : "scan",
          `tasks (1)/it's ${label}.py@demo`,
          "--limit",
          "5",
          "-T",
          // The batch stand-in re-parses its arguments through cmd, so the
          // Windows values stay within what a quoted batch argument keeps.
          windows ? "prompt=hello (world) & co" : "prompt=say $HOME; & done",
        ];
        await runCommand(profile, args, cwd);
        const deadline = Date.now() + 15000;
        while (!existsSync(result) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(
          existsSync(result),
          `${command} ${label}: terminal task should finish; output: ${output}`
        );
        const actual = JSON.parse(readFileSync(result, "utf8")) as {
          command: string;
          args: string[];
          cwd: string;
          activation: string | null;
        };
        assert.strictEqual(
          actual.command,
          command,
          "the environment's console script ran"
        );
        assert.deepStrictEqual(actual.args, args);
        assert.strictEqual(
          resolve(actual.cwd)
            .replace(/^\/private/, "")
            .toLowerCase(),
          resolve(cwd)
            .replace(/^\/private/, "")
            .toLowerCase()
        );
        assert.strictEqual(actual.activation, "terminal-activation");
        assert.strictEqual(
          existsSync(marker),
          false,
          "the PATH decoy must never run"
        );
        // A result file can appear before the task has exited. Repeated Run
        // happens at the shell prompt, not while the prior task owns stdin.
        const terminal = terminals[terminals.length - 1]!;
        const completedBy = Date.now() + 10000;
        while (running.has(terminal) && Date.now() < completedBy) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(
          !running.has(terminal),
          "previous terminal command should finish"
        );
      }
    }
    assert.strictEqual(
      terminals.length,
      2,
      "repeated Run reuses the terminal without requiring a close"
    );
  } finally {
    Object.defineProperty(window, "createTerminal", original);
    outputListener.dispose();
    await Promise.all(
      terminals.map(
        (terminal) =>
          new Promise<void>((resolve) => {
            const listener = window.onDidCloseTerminal((closed) => {
              if (closed === terminal) {
                clearTimeout(timeout);
                listener.dispose();
                resolve();
              }
            });
            const timeout = setTimeout(() => {
              listener.dispose();
              resolve();
            }, 5000);
            terminal.dispose();
          })
      )
    );
    // Windows holds the terminal cwd until its process has actually exited.
    // Async retries allow VS Code to process the close/exit notifications.
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
