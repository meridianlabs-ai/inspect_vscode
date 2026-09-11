import * as assert from "node:assert";
import {
  spawnSync,
  SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

import {
  createRunTransport,
  crtQuote,
  printfOctal,
  resolveLaunchVector,
} from "../../core/package/run-transport";

const windows = process.platform === "win32";
const python = windows ? "python" : "python3";
const selected = spawnSync(python, ["-c", "import sys;print(sys.executable)"], {
  encoding: "utf8",
}).stdout?.trim();
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";

// Shells are located with the test process PATH; the launched command itself
// runs with a PATH that contains no Python at all.
const locate = (name: string): string | undefined => {
  const found = spawnSync(windows ? "where.exe" : "which", [name], {
    encoding: "utf8",
  });
  return found.status === 0
    ? found.stdout.split(/\r?\n/)[0]?.trim()
    : undefined;
};

const shells: { name: string; executable?: string; args: string[] }[] = windows
  ? [
      {
        name: "cmd",
        executable: join(systemRoot, "System32", "cmd.exe"),
        args: ["/d", "/v:off", "/s", "/c"],
      },
      {
        name: "cmd delayed expansion",
        executable: join(systemRoot, "System32", "cmd.exe"),
        args: ["/d", "/v:on", "/s", "/c"],
      },
      {
        name: "Windows PowerShell",
        executable: join(
          systemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe"
        ),
        args: ["-NoProfile", "-Command"],
      },
      {
        name: "PowerShell 7",
        executable: locate("pwsh.exe"),
        args: ["-NoProfile", "-Command"],
      },
      {
        name: "Git Bash",
        executable: "C:\\Program Files\\Git\\bin\\bash.exe",
        args: ["--noprofile", "--norc", "-c"],
      },
    ]
  : [
      {
        name: "Unix PowerShell",
        executable: locate("pwsh"),
        args: ["-NoProfile", "-Command"],
      },
      { name: "sh", executable: "/bin/sh", args: ["-c"] },
      {
        name: "bash",
        executable: "/bin/bash",
        args: ["--noprofile", "--norc", "-c"],
      },
      {
        name: "fish",
        executable: locate("fish"),
        args: ["--no-config", "-c"],
      },
      {
        name: "bash startup replaces itself with fish",
        executable: "/bin/bash",
        args: [
          "-c",
          `exec "${locate("fish") ?? "fish"}" --no-config -c "$1"`,
          "bash",
        ],
      },
    ];

// cmd does not implement the Windows CRT argv parser. Match the raw /s /c
// transport used by a terminal instead of Node's default CRT quote escaping.
const runShell = (
  shell: (typeof shells)[number],
  line: string,
  options: SpawnSyncOptionsWithStringEncoding = { encoding: "utf8" }
) => {
  const cmd = basename(shell.executable ?? "").toLowerCase() === "cmd.exe";
  return spawnSync(
    shell.executable ?? shell.name,
    [...shell.args, cmd ? `"${line}"` : line],
    {
      ...options,
      windowsVerbatimArguments: cmd,
    }
  );
};

// Executables that a shell would find by bare name. They record that they ran
// and fail, so any dependence on the shell's search order is visible.
const writeDecoys = (dir: string, marker: string) => {
  if (windows) {
    writeFileSync(
      join(dir, "python.cmd"),
      `@echo unselected>"${marker}"\r\n@exit /b 23\r\n`
    );
    writeFileSync(
      join(dir, "python3.cmd"),
      `@echo unselected>"${marker}"\r\n@exit /b 23\r\n`
    );
    // cmd prefers .exe over .cmd; an unrelated system tool stands in for a
    // hostile binary without needing a compiler.
    copyFileSync(
      join(systemRoot, "System32", "where.exe"),
      join(dir, "python.exe")
    );
  } else {
    for (const name of ["python", "python3"]) {
      const decoy = join(dir, name);
      writeFileSync(
        decoy,
        `#!/bin/sh\nprintf unselected > "${marker}"\nexit 23\n`
      );
      chmodSync(decoy, 0o755);
    }
  }
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

suite("Run transport through real shells", () => {
  for (const shell of shells) {
    for (const vector of ["selected interpreter", "wrapper"] as const) {
      test(`${shell.name}: ${vector} runs without PATH Python, ignoring cwd/PATH decoys`, function () {
        this.timeout(30000);
        const probe = runShell(shell, windows ? "exit 0" : "true");
        if (
          (probe.error || !shell.executable) &&
          shell.name.includes("fish") &&
          !process.env.REQUIRE_FISH_TESTS
        ) {
          this.skip();
        }
        if (
          (probe.error || !shell.executable) &&
          shell.name.includes("PowerShell") &&
          !windows &&
          !process.env.REQUIRE_PWSH_TESTS
        ) {
          this.skip();
        }
        assert.ok(shell.executable, `${shell.name} must be installed`);
        assert.ifError(probe.error);
        assert.ok(selected, "Python must be installed for transport tests");
        const root = mkdtempSync(join(tmpdir(), "inspect-transport-test-"));
        const marker = join(root, "UNSELECTED");
        const launchCwd = join(root, "launch");
        mkdirSync(launchCwd);
        writeDecoys(launchCwd, marker);
        // Modules in the shell's current directory must not shadow the
        // launcher's imports.
        writeFileSync(
          join(launchCwd, "json.py"),
          "raise RuntimeError('unselected startup module imported')\n"
        );
        const pathDir = join(root, "path");
        mkdirSync(pathDir);
        writeDecoys(pathDir, marker);
        const cwd = join(root, "cwd [demo] & %literal%!");
        mkdirSync(cwd);
        // Hostile installation path: every character the supported shells
        // could interpret, within what the file system allows.
        const venv = join(
          root,
          windows
            ? "venv $x 'a' !h %p ^c &d (f) [g] {h} =i ,j ~k #l @m café 日本語"
            : "venv $x `t` \"q\" 'a' \\b !h %p &c;d|e (f) [g] café 日本語 ~u #z\nnext line"
        );
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
        let launch = [interpreter];
        if (vector === "wrapper") {
          // e.g. a shim that forwards to the interpreter with extra arguments.
          // cmd reads batch files in the OEM code page, so the Windows shim
          // stays ASCII and finds the interpreter next to itself in the
          // hostile venv directory.
          const wrapper = windows
            ? join(dirname(interpreter), "py wrapper.cmd")
            : join(root, "wrapper $dir", "py");
          mkdirSync(dirname(wrapper), { recursive: true });
          writeFileSync(
            wrapper,
            windows
              ? `@if not "%~1"=="--wrapped" exit /b 9\r\n@"%~dp0python.exe" %2 %3\r\n`
              : `#!/bin/sh\n[ "$1" = --wrapped ] || exit 9\nshift\nexec ${shellQuote(interpreter)} "$@"\n`
          );
          if (!windows) {
            chmodSync(wrapper, 0o755);
          }
          launch = [wrapper, "--wrapped"];
        }
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
        const injected = join(root, "INJECTED");
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
          ...["“", "”", "„", "‘", "’", "‚", "‛"].map(
            (quote) =>
              `tasks${quote}; New-Item INJECTED -ItemType File; #/task.py@demo`
          ),
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
            "  json.dump({'args':sys.argv[1:],'cwd':os.getcwd(),'python':sys.executable,'path0':sys.path[0],'activation':os.environ['TRANSPORT_ACTIVATED']},f)",
            " print('task output visible')",
          ].join("\n")
        );
        const transport = createRunTransport(
          launch,
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
          assert.match(transport.commandLine, /^[\x20-\x7e]+$/);
          const run = runShell(shell, transport.commandLine, {
            encoding: "utf8",
            cwd: launchCwd,
            env: {
              ...process.env,
              // No Python anywhere on PATH: only decoys (plus the Windows
              // system directory, which contains no Python).
              PATH: windows
                ? `${pathDir};${join(systemRoot, "System32")}`
                : pathDir,
              PYTHONPATH: root,
              TRANSPORT_RESULT: result,
              TRANSPORT_ACTIVATED: "selected-environment",
            },
          });
          assert.ifError(run.error);
          assert.strictEqual(
            existsSync(marker),
            false,
            "a bare python decoy in cwd or PATH must never execute"
          );
          assert.strictEqual(run.status, 0, run.stderr);
          assert.match(run.stdout, /task output visible/);
          const actual = JSON.parse(readFileSync(result, "utf8")) as {
            args: string[];
            cwd: string;
            python: string;
            path0: string;
            activation: string;
          };
          assert.deepStrictEqual(actual.args, args);
          // macOS may canonicalize /var to /private/var.
          const canonical = (value: string) =>
            value.replace(/^\/private/, "").toLowerCase();
          assert.strictEqual(canonical(actual.cwd), canonical(cwd));
          assert.strictEqual(canonical(actual.python), canonical(interpreter));
          assert.notStrictEqual(
            canonical(actual.path0),
            canonical(launchCwd),
            "the shell's current directory is not on the import path"
          );
          assert.strictEqual(actual.activation, "selected-environment");
          assert.strictEqual(existsSync(injected), false);
          assert.strictEqual(existsSync(join(launchCwd, "INJECTED")), false);
          // Payloads are consumed once, preventing accidental replay of stale runs.
          const replay = runShell(shell, transport.commandLine);
          assert.notStrictEqual(replay.status, 0);
        } finally {
          transport.dispose();
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
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
      const shell =
        shells.find((candidate) => candidate.name === "sh") ?? shells[0]!;
      const run = runShell(shell, transport.commandLine);
      assert.notStrictEqual(run.status, 0);
      assert.doesNotMatch(run.stdout, /Zen of Python/);
    } finally {
      transport.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing selected interpreter fails instead of searching", () => {
    const root = mkdtempSync(join(tmpdir(), "inspect-missing-test-"));
    const pathDir = join(root, "path");
    mkdirSync(pathDir);
    writeDecoys(pathDir, join(root, "UNSELECTED"));
    const transport = createRunTransport(
      [join(root, windows ? "absent\\python.exe" : "absent/python")],
      "missing-distribution",
      "missing-command",
      [],
      root
    );
    try {
      const shell = shells.find((s) => s.name === (windows ? "cmd" : "sh"))!;
      const run = runShell(shell, transport.commandLine, {
        encoding: "utf8",
        cwd: pathDir,
        env: { ...process.env, PATH: pathDir },
      });
      assert.notStrictEqual(run.status, 0);
      assert.strictEqual(existsSync(join(root, "UNSELECTED")), false);
    } finally {
      transport.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

suite("Run transport command lines", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-transport-shape-"));
  suiteTeardown(() => rmSync(root, { recursive: true, force: true }));

  test("refuses a launch vector the shell would have to search for", () => {
    for (const vector of [[], ["python"], ["./venv/bin/python"]]) {
      assert.throws(() =>
        createRunTransport(vector, "inspect-ai", "inspect", [], root)
      );
    }
  });

  test("Unix: fixed /bin/sh launcher, ASCII program, no quote breakouts", () => {
    const transport = createRunTransport(
      ["/opt/py $x `y` 'z' \"w\"\\v !u %t/bin/python", "-X", "utf8"],
      "inspect-ai",
      "inspect",
      ["eval", "task ’x.py"],
      "/cwd [literal]",
      "linux"
    );
    try {
      const line = transport.commandLine;
      assert.match(line, /^\/bin\/sh -c '[\x20-\x7e]*'$/);
      const program = line.slice("/bin/sh -c '".length, -1);
      assert.strictEqual(program.includes("'"), false);
      assert.strictEqual(program.includes("!"), false);
      assert.strictEqual(line.includes("py $x"), false);
      assert.strictEqual(line.includes("task"), false);
      assert.strictEqual(line.includes("/cwd"), false);
      assert.match(program, /^a0=\$\(printf "\/opt\/py\\040\\044x/);
      assert.match(
        program,
        /;exec "\$\{a0%x\}" "\$\{a1%x\}" "\$\{a2%x\}" "\$\{a3%x\}" "\$\{a4%x\}"$/
      );
    } finally {
      transport.dispose();
    }
  });

  test("Windows: fixed Windows PowerShell launcher with an encoded program", () => {
    const interpreter = "C:\\Users\\O'Brien $x !y %z\\python.exe";
    const transport = createRunTransport(
      [interpreter, "-X", "utf8"],
      "inspect-ai",
      "inspect",
      ["eval", "task ”x.py"],
      "C:\\cwd [literal]",
      "win32",
      "D:\\WINDOWS\\"
    );
    try {
      const line = transport.commandLine;
      const prefix =
        'D:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "';
      assert.ok(line.startsWith(prefix), line);
      assert.match(line, /^[\x20-\x7e]+$/);
      const encoded = line.slice(prefix.length, -1);
      assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
      const script = Buffer.from(encoded, "base64").toString("utf16le");
      assert.ok(
        script.includes(
          "$i.FileName='C:\\Users\\O''Brien $x !y %z\\python.exe'"
        )
      );
      assert.match(
        script,
        /\$i\.Arguments='-X utf8 "?[^"]*inspect_run_launcher\.py"? "?[^"]*run\.json"?'/
      );
      assert.ok(script.includes("UseShellExecute=$false"));
      assert.ok(script.includes("exit $p.ExitCode"));
      assert.strictEqual(script.includes("task"), false);
      assert.strictEqual(script.includes("cwd"), false);
    } finally {
      transport.dispose();
    }
  });

  test("Windows: a batch wrapper is started through cmd.exe /s /c", () => {
    const transport = createRunTransport(
      ["C:\\Tools dir\\py wrapper.cmd", "--wrapped"],
      "inspect-ai",
      "inspect",
      [],
      "C:\\cwd",
      "win32",
      "C:\\WINDOWS"
    );
    try {
      const encoded = transport.commandLine.split('-EncodedCommand "')[1]!;
      const script = Buffer.from(encoded.slice(0, -1), "base64").toString(
        "utf16le"
      );
      assert.ok(
        script.includes("$i.FileName='C:\\WINDOWS\\System32\\cmd.exe'")
      );
      assert.match(
        script,
        /\$i\.Arguments='\/d \/v:off \/s \/c ""C:\\Tools dir\\py wrapper\.cmd" --wrapped "?[^"]*inspect_run_launcher\.py"? "?[^"]*run\.json"?"'/
      );
    } finally {
      transport.dispose();
    }
  });

  test("Windows: an unsupported SystemRoot is refused rather than searched", () => {
    for (const systemRoot of ["", "C:\\Win dows", "relative", "C:\\W$"]) {
      assert.throws(
        () =>
          createRunTransport(
            ["C:\\Python\\python.exe"],
            "inspect-ai",
            "inspect",
            [],
            "C:\\",
            "win32",
            systemRoot
          ),
        /SystemRoot/
      );
    }
  });

  test("printf octal keeps only [A-Za-z0-9/._] literal", () => {
    assert.strictEqual(printfOctal("/a/B9._"), "/a/B9._");
    assert.strictEqual(
      printfOctal(" -$'\"\\!%\n"),
      "\\040\\055\\044\\047\\042\\134\\041\\045\\012"
    );
    assert.strictEqual(printfOctal("é"), "\\303\\251");
  });

  test("CRT quoting matches Python's subprocess.list2cmdline", function () {
    if (!selected) {
      this.skip();
    }
    const samples = [
      "plain",
      "with space",
      'q"uote',
      "back\\slash\\",
      'mix \\"x\\\\ "',
      "",
      "tab\there",
      "日本語 café",
      "trailing space ",
      'ends\\"',
    ];
    const oracle = spawnSync(
      selected,
      [
        "-c",
        "import sys,json,subprocess;print(json.dumps(subprocess.list2cmdline(json.loads(sys.argv[1]))))",
        JSON.stringify(samples),
      ],
      { encoding: "utf8" }
    );
    assert.strictEqual(oracle.status, 0, oracle.stderr);
    assert.strictEqual(
      samples.map(crtQuote).join(" "),
      JSON.parse(oracle.stdout) as string
    );
  });
});

suite("Launch vector resolution", () => {
  const root = mkdtempSync(join(tmpdir(), "inspect-resolve-"));
  const pathDir = join(root, "path");
  const cwd = join(root, "cwd");
  suiteSetup(() => {
    mkdirSync(pathDir);
    mkdirSync(cwd);
    for (const name of ["python", "python.exe", "python.cmd"]) {
      writeFileSync(join(cwd, name), "");
    }
  });
  suiteTeardown(() => rmSync(root, { recursive: true, force: true }));

  test("absolute vectors pass through unchanged", () => {
    const vector = [join(root, "venv", "bin", "python"), "-X", "utf8"];
    assert.deepStrictEqual(resolveLaunchVector(vector, cwd), vector);
  });

  test("relative paths are anchored at the workspace, not the shell", () => {
    assert.deepStrictEqual(
      resolveLaunchVector(["venv/bin/python"], cwd, process.platform),
      [resolve(cwd, "venv/bin/python")]
    );
  });

  test("a bare name is looked up on PATH only, never in the current directory", () => {
    // Only cwd has python; PATH lists an empty entry, a relative entry that
    // names cwd, and a trusted absolute directory without python.
    // Relative entries stay relative even across Windows drives.
    const env = {
      PATH: ["", ".", basename(cwd), pathDir].join(delimiter),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    try {
      assert.throws(
        () => resolveLaunchVector(["python"], cwd, process.platform, env),
        /not found on PATH/
      );
      writeFileSync(join(pathDir, "python"), "");
      assert.deepStrictEqual(
        resolveLaunchVector(["python"], cwd, process.platform, env),
        [join(pathDir, "python")]
      );
    } finally {
      rmSync(join(pathDir, "python"), { force: true });
    }
  });

  test("Windows PATHEXT is honoured for bare names", () => {
    const env = { PATH: pathDir, PATHEXT: ".COM;.EXE;.CMD" };
    try {
      assert.throws(() => resolveLaunchVector(["python"], cwd, "win32", env));
      writeFileSync(join(pathDir, "python.CMD"), "");
      const resolved = resolveLaunchVector(["python", "-u"], cwd, "win32", env);
      assert.strictEqual(resolved.length, 2);
      assert.strictEqual(
        resolved[0]!.toLowerCase(),
        join(pathDir, "python.cmd").toLowerCase()
      );
      assert.strictEqual(resolved[1], "-u");
    } finally {
      rmSync(join(pathDir, "python.CMD"), { force: true });
    }
  });

  test("an empty vector is rejected", () => {
    assert.throws(() => resolveLaunchVector([], cwd), /No active Python/);
  });
});
