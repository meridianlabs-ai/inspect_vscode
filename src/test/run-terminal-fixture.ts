import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { TerminalOptions, version, window } from "vscode";

import { ExecProfile, runCommand } from "../core/package/exec-manager";
import { AbsolutePath } from "../core/path";

export async function verifyRunTerminal() {
  const windows = process.platform === "win32";
  if (!windows && spawnSync("fish", ["--version"]).error) {
    if (process.env.REQUIRE_FISH_TESTS) {
      assert.fail("fish is required");
    }
    return;
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
      " with open(os.environ['TRANSPORT_RESULT'], 'w', encoding='utf-8') as f:",
      "  json.dump({'args':sys.argv[1:],'cwd':os.getcwd(),'activation':os.environ['TRANSPORT_ACTIVATED']},f)",
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
  writeFileSync(rcfile, "exec fish --no-config -i\n");
  const result = join(root, "result.json");
  const original = Object.getOwnPropertyDescriptor(window, "createTerminal")!;
  const create = window.createTerminal;
  const terminals: ReturnType<typeof create>[] = [];
  const cleanups: { dispose: () => void }[] = [];
  Object.defineProperty(window, "createTerminal", {
    configurable: true,
    value: (options: TerminalOptions) => {
      const terminal = create({
        ...options,
        ...(windows
          ? {}
          : { shellPath: "/bin/bash", shellArgs: ["--rcfile", rcfile] }),
        env: {
          PYTHONPATH: root,
          TRANSPORT_RESULT: result,
          TRANSPORT_ACTIVATED: "terminal-activation",
          PATH:
            dirname(selected) +
            (windows ? ";" : ":") +
            (process.env.PATH || ""),
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
        assert.ok(existsSync(result), "terminal task should finish");
        const actual = JSON.parse(readFileSync(result, "utf8")) as {
          args: string[];
          cwd: string;
          activation: string;
        };
        assert.deepStrictEqual(actual.args, args);
        assert.strictEqual(
          actual.cwd.replace(/^\/private/, ""),
          cwd.replace(/^\/private/, "")
        );
        assert.strictEqual(actual.activation, "terminal-activation");
        assert.strictEqual(existsSync(join(cwd, "INJECTED")), false);
      }
    }
    assert.strictEqual(
      terminals.length,
      2,
      "repeated Run reuses the terminal without requiring a close"
    );
  } finally {
    Object.defineProperty(window, "createTerminal", original);
    for (const terminal of terminals) {
      terminal.dispose();
    }
    for (const cleanup of cleanups) {
      cleanup.dispose();
    }
    rmSync(root, { recursive: true, force: true });
  }
}
