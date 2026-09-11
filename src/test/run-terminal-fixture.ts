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

import { TerminalOptions, version, window } from "vscode";

import { ExecProfile, runCommand } from "../core/package/exec-manager";
import { AbsolutePath } from "../core/path";

export async function verifyRunTerminal(
  shell: "startup" | "powershell" = "startup"
): Promise<boolean> {
  const windows = process.platform === "win32";
  // The terminal runs with no Python on PATH, so shells are started by
  // absolute path.
  const locate = (name: string): string | undefined => {
    const found = spawnSync(windows ? "where.exe" : "which", [name], {
      encoding: "utf8",
    });
    return found.status === 0
      ? found.stdout.split(/\r?\n/)[0]?.trim()
      : undefined;
  };
  const fish = locate("fish");
  if (shell === "startup" && !windows && !fish) {
    if (process.env.REQUIRE_FISH_TESTS) {
      assert.fail("fish is required");
    }
    return false;
  }
  const pwsh = locate("pwsh");
  if (shell === "powershell" && !pwsh) {
    if (process.env.REQUIRE_PWSH_TESTS) {
      assert.fail("PowerShell is required");
    }
    return false;
  }
  const selected = spawnSync(
    windows ? "python" : "python3",
    ["-c", "import sys;print(sys.executable)"],
    { encoding: "utf8" }
  ).stdout.trim();
  assert.ok(selected);
  const root = mkdtempSync(join(tmpdir(), "inspect-terminal-test-"));
  const cwd = join(root, "cwd [demo] & %literal%!");
  mkdirSync(cwd);
  // Bare `python`/`python3` decoys in the terminal's current directory and at
  // the front of PATH record that they ran. The selected interpreter's own
  // directory is removed from PATH: the launch must not need it there.
  const marker = join(root, "UNSELECTED");
  const decoyDir = join(root, "decoys");
  mkdirSync(decoyDir);
  for (const dir of [decoyDir, cwd]) {
    for (const name of windows
      ? ["python.cmd", "python3.cmd"]
      : ["python", "python3"]) {
      const decoy = join(dir, name);
      writeFileSync(
        decoy,
        windows
          ? `@echo unselected>"${marker}"\r\n@exit /b 23\r\n`
          : `#!/bin/sh\nprintf unselected > "${marker}"\nexit 23\n`
      );
      if (!windows) {
        chmodSync(decoy, 0o755);
      }
    }
  }
  const selectedDir = resolve(dirname(selected)).toLowerCase();
  const terminalPath = [
    decoyDir,
    ...(process.env.PATH || "")
      .split(delimiter)
      .filter((entry) => entry && resolve(entry).toLowerCase() !== selectedDir),
  ].join(delimiter);
  const fixture = join(root, "inspect_ai");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "__init__.py"), "");
  const metadata = join(root, "inspect_ai-1.0.dist-info");
  mkdirSync(metadata);
  writeFileSync(join(metadata, "METADATA"), "Name: inspect-ai\nVersion: 1.0\n");
  writeFileSync(
    join(metadata, "entry_points.txt"),
    "[console_scripts]\ninspect = inspect_ai.__main__:main\n"
  );
  writeFileSync(
    join(fixture, "__main__.py"),
    [
      "import json,os,sys",
      "def main():",
      " result=os.environ['TRANSPORT_RESULT']",
      " with open(result+'.tmp', 'w', encoding='utf-8') as f:",
      "  json.dump({'args':sys.argv[1:],'cwd':os.getcwd(),'python':sys.executable,'activation':os.environ['TRANSPORT_ACTIVATED']},f)",
      " os.replace(result+'.tmp',result)",
      " print('Inspect test output')",
    ].join("\n")
  );
  const scoutMetadata = join(root, "inspect_scout-1.0.dist-info");
  mkdirSync(scoutMetadata);
  writeFileSync(
    join(scoutMetadata, "METADATA"),
    "Name: inspect-scout\nVersion: 1.0\n"
  );
  // Scout has a console entry point but no package __main__ module.
  writeFileSync(
    join(scoutMetadata, "entry_points.txt"),
    "[console_scripts]\nscout = inspect_ai.__main__:main\n"
  );
  const rcfile = join(root, "startup.bash");
  writeFileSync(rcfile, `exec "${fish}" --no-config -i\n`);
  const result = join(root, "result.json");
  const original = Object.getOwnPropertyDescriptor(window, "createTerminal")!;
  const create = window.createTerminal;
  const terminals: ReturnType<typeof create>[] = [];
  const cleanups: { dispose: () => void }[] = [];
  let output = "";
  const reading = new Set<(typeof terminals)[number]>();
  const outputListener = window.onDidStartTerminalShellExecution((event) => {
    if (terminals.includes(event.terminal)) {
      reading.add(event.terminal);
      void (async () => {
        for await (const data of event.execution.read()) {
          output = (output + data).slice(-20000);
        }
      })()
        .catch((error: unknown) => {
          output += String(error);
        })
        .finally(() => {
          reading.delete(event.terminal);
        });
    }
  });
  Object.defineProperty(window, "createTerminal", {
    configurable: true,
    value: (options: TerminalOptions) => {
      const terminal = create({
        ...options,
        ...(shell === "powershell"
          ? { shellPath: pwsh, shellArgs: ["-NoLogo", "-NoProfile"] }
          : windows
            ? {}
            : { shellPath: "/bin/bash", shellArgs: ["--rcfile", rcfile] }),
        env: {
          PYTHONPATH: root,
          TRANSPORT_RESULT: result,
          TRANSPORT_ACTIVATED: "terminal-activation",
          PATH: terminalPath,
        },
      });
      if (version.startsWith("1.93.")) {
        assert.strictEqual(
          "shell" in terminal.state,
          false,
          "minimum host has no shell identity reporting"
        );
      }
      terminals.push(terminal);
      return terminal;
    },
  });
  try {
    for (const profile of [
      {
        packageName: "inspect-ai",
        command: "inspect",
        terminal: "Inspect Eval",
        target: "Eval",
      },
      {
        packageName: "inspect-scout",
        command: "scout",
        terminal: "Scout Scan",
        target: "Scan",
      },
    ] as ExecProfile[]) {
      for (const label of ["first", "repeated"]) {
        rmSync(result, { force: true });
        const args = [
          "eval",
          label === "first"
            ? "tasks”; New-Item INJECTED -ItemType File; “x/task.py@demo"
            : "demo’; New-Item INJECTED -ItemType File; #/task.py@demo",
          ...["“", "”", "„", "‘", "’", "‚", "‛"].map(
            (quote) =>
              `task${quote}; New-Item INJECTED -ItemType File; #.py@demo`
          ),
          "t\\';echo INJECTED>INJECTED;#'.py@demo",
          label,
          "%PATH%",
          "!PATH!",
          "a\\",
        ];
        cleanups.push(
          await runCommand(profile, args, cwd, {
            path: selected,
          } as AbsolutePath)
        );
        const deadline = Date.now() + 10000;
        while (!existsSync(result) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(
          existsSync(result),
          `${profile.command} ${label}: terminal task should finish; output: ${output}`
        );
        const actual = JSON.parse(readFileSync(result, "utf8")) as {
          args: string[];
          cwd: string;
          python: string;
          activation: string;
        };
        assert.deepStrictEqual(actual.args, args);
        assert.strictEqual(
          actual.cwd.replace(/^\/private/, ""),
          cwd.replace(/^\/private/, "")
        );
        assert.strictEqual(
          actual.python.replace(/^\/private/, "").toLowerCase(),
          selected.replace(/^\/private/, "").toLowerCase(),
          "the selected interpreter ran, not a PATH or cwd python"
        );
        assert.strictEqual(
          existsSync(marker),
          false,
          "a bare python decoy must never execute"
        );
        assert.strictEqual(actual.activation, "terminal-activation");
        assert.strictEqual(existsSync(join(cwd, "INJECTED")), false);
        // A result file can appear before Python has exited. Normal repeated
        // Run happens at the shell prompt, not while the prior task owns stdin.
        const terminal = terminals[terminals.length - 1]!;
        const completedBy = Date.now() + 10000;
        while (reading.has(terminal) && Date.now() < completedBy) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(
          !reading.has(terminal),
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
    for (const cleanup of cleanups) {
      cleanup.dispose();
    }
    // Windows holds the terminal cwd until its process has actually exited.
    // Async retries allow VS Code to process the close/exit notifications.
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  return true;
}
