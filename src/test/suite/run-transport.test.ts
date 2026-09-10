import * as assert from "node:assert";
import {
  spawnSync,
  SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRunTransport } from "../../core/package/run-transport";

const windows = process.platform === "win32";
const python = windows ? "python" : "python3";
const selected = spawnSync(python, ["-c", "import sys;print(sys.executable)"], {
  encoding: "utf8",
}).stdout?.trim();
const shells: { name: string; executable: string; args: string[] }[] = windows
  ? [
      {
        name: "cmd",
        executable: "cmd.exe",
        args: ["/d", "/v:off", "/s", "/c"],
      },
      {
        name: "cmd delayed expansion",
        executable: "cmd.exe",
        args: ["/d", "/v:on", "/s", "/c"],
      },
      {
        name: "Windows PowerShell",
        executable: "powershell.exe",
        args: ["-NoProfile", "-Command"],
      },
      {
        name: "PowerShell 7",
        executable: "pwsh.exe",
        args: ["-NoProfile", "-Command"],
      },
      {
        name: "Git Bash",
        executable: "C:\\Program Files\\Git\\bin\\bash.exe",
        args: ["--noprofile", "--norc", "-c"],
      },
    ]
  : [
      { name: "sh", executable: "/bin/sh", args: ["-c"] },
      {
        name: "bash",
        executable: "/bin/bash",
        args: ["--noprofile", "--norc", "-c"],
      },
      { name: "fish", executable: "fish", args: ["--no-config", "-c"] },
      {
        name: "bash startup replaces itself with fish",
        executable: "/bin/bash",
        args: ["-c", 'exec fish --no-config -c "$1"', "bash"],
      },
    ];

// cmd does not implement the Windows CRT argv parser. Match the raw /s /c
// transport used by a terminal instead of Node's default CRT quote escaping.
const runShell = (
  shell: (typeof shells)[number],
  line: string,
  options: SpawnSyncOptionsWithStringEncoding = { encoding: "utf8" }
) => {
  const cmd = shell.executable === "cmd.exe";
  return spawnSync(
    shell.executable,
    [...shell.args, cmd ? `"${line}"` : line],
    {
      ...options,
      windowsVerbatimArguments: cmd,
    }
  );
};

suite("Run transport through real shells", () => {
  for (const shell of shells) {
    test(`${shell.name}: literal argv, cwd, selected Python and inherited environment`, function () {
      this.timeout(15000);
      const probe = runShell(shell, windows ? "exit 0" : "true");
      if (
        probe.error &&
        shell.name.includes("fish") &&
        !process.env.REQUIRE_FISH_TESTS
      ) {
        this.skip();
      }
      assert.ifError(probe.error);
      assert.ok(selected, "Python must be installed for transport tests");
      const root = mkdtempSync(join(tmpdir(), "inspect-transport-test-"));
      const cwd = join(root, "cwd [demo] & %literal%!");
      mkdirSync(cwd);
      const venv = join(root, "venv with spaces & [brackets]");
      const created = spawnSync(
        selected,
        ["-m", "venv", "--without-pip", venv],
        { encoding: "utf8" }
      );
      assert.strictEqual(created.status, 0, created.stderr);
      const interpreter = join(
        venv,
        windows ? "Scripts/python.exe" : "bin/python"
      );
      const metadata = join(root, "transport_fixture-1.0.dist-info");
      mkdirSync(metadata);
      writeFileSync(
        join(metadata, "METADATA"),
        "Name: transport-fixture\nVersion: 1.0\n"
      );
      writeFileSync(
        join(metadata, "entry_points.txt"),
        "[console_scripts]\nfixture = transport_fixture:main\n"
      );
      const result = join(root, "result.json");
      const marker = join(root, "INJECTED");
      const args = [
        "",
        "ordinary.py@task",
        "space bearing path.py",
        "a\\",
        "a&b.py",
        "%USERNAME%.py",
        "!PATH!",
        "a^b",
        "[demo]",
        "quotes'\"‘’",
        "$(touch INJECTED)",
        "`touch INJECTED`",
        "t\\';echo INJECTED>INJECTED;#'.py@demo",
        "x\ny\rz",
        "Unicode café 日本語",
        "-T",
        "a=\\",
        "-T",
        "b=;echo INJECTED;#",
        "long=" + "x".repeat(20000),
      ];
      writeFileSync(
        join(root, "transport_fixture.py"),
        [
          "import json,os,sys",
          "def main():",
          " with open(os.environ['TRANSPORT_RESULT'], 'w', encoding='utf-8') as f:",
          "  json.dump({'args':sys.argv[1:],'cwd':os.getcwd(),'python':sys.executable,'activation':os.environ['TRANSPORT_ACTIVATED']},f)",
          " print('task output visible')",
        ].join("\n")
      );
      const transport = createRunTransport(
        [interpreter],
        "transport-fixture",
        "fixture",
        args,
        cwd
      );
      try {
        assert.ok(
          transport.commandLine.length < 8191,
          "cmd input stays bounded despite large task arguments"
        );
        const run = runShell(shell, transport.commandLine, {
          encoding: "utf8",
          cwd: root,
          env: {
            ...process.env,
            PYTHONPATH: root,
            TRANSPORT_RESULT: result,
            TRANSPORT_ACTIVATED: "selected-environment",
          },
        });
        assert.ifError(run.error);
        assert.strictEqual(run.status, 0, run.stderr);
        assert.match(run.stdout, /task output visible/);
        const actual = JSON.parse(readFileSync(result, "utf8")) as {
          args: string[];
          cwd: string;
          python: string;
          activation: string;
        };
        assert.deepStrictEqual(actual.args, args);
        // macOS may canonicalize /var to /private/var.
        assert.strictEqual(
          actual.cwd.replace(/^\/private/, ""),
          cwd.replace(/^\/private/, "")
        );
        assert.strictEqual(
          actual.python.replace(/^\/private/, ""),
          interpreter.replace(/^\/private/, "")
        );
        assert.strictEqual(actual.activation, "selected-environment");
        assert.strictEqual(existsSync(marker), false);
        // Payloads are consumed once, preventing accidental replay of stale runs.
        const replay = runShell(shell, transport.commandLine);
        assert.notStrictEqual(replay.status, 0);
      } finally {
        transport.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test("an invalid working directory prevents task execution", () => {
    assert.ok(selected);
    const root = mkdtempSync(join(tmpdir(), "inspect-cwd-test-"));
    const transport = createRunTransport(
      [selected],
      "missing-distribution",
      "missing-command",
      [],
      join(root, "missing")
    );
    try {
      const shell = shells[0]!;
      const run = runShell(shell, transport.commandLine);
      assert.notStrictEqual(run.status, 0);
      assert.doesNotMatch(run.stdout, /Zen of Python/);
    } finally {
      transport.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
