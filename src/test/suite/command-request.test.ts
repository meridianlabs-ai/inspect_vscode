import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Uri } from "vscode";

import {
  CommandDirectory,
  readCommandFile,
} from "../../providers/inspect/command-file";
import {
  handleCommandRequest,
  parseCommandRequest,
} from "../../providers/inspect/command-request";

const request = (target: string) => ({
  command: "inspect.openLogViewer",
  args: [target],
});

suite("Command-file IPC", () => {
  const valid = request("file:///tmp/example.eval");

  test("accepts producer log and sample requests on supported backends", () => {
    for (const target of [
      "file:///tmp/a%20log.json",
      "file:///C:/logs/run.eval",
      "file:///home/user/logs/run.eval?sample_id=hello+world&epoch=1",
      "s3://bucket/logs/run.eval?sample_id=42&epoch=2",
      "https://example.com/logs/run.json",
      "abfss://logs@account.dfs.core.windows.net/run.eval",
      "http://localhost:7575/logs/run.eval",
    ]) {
      assert.deepStrictEqual(
        parseCommandRequest([request(target)]).map((uri) => {
          assert.ok(uri instanceof Uri);
          return uri.toString();
        }),
        [Uri.parse(target).toString()]
      );
    }
  });

  test("rejects non-allowlisted commands even with inspect prefix", async () => {
    for (const command of [
      "workbench.action.terminal.new",
      "workbench.action.terminal.sendSequence",
      "workbench.extensions.installExtension",
      "workbench.action.tasks.runTask",
      "inspect.runTask",
      "inspect.debugTask",
      "inspect.createTask",
      "inspect.logListingDeleteLogFile",
      "inspect.openScanViewer",
      "remote-containers.attachToRunningContainer",
    ]) {
      await assert.rejects(
        handleCommandRequest([valid, { command, args: [] }], {
          confirmRemote: () => {
            assert.fail("invalid batch prompted");
          },
          openLog: () => {
            assert.fail("invalid batch executed");
          },
        })
      );
    }
  });

  test("rejects malformed schemas and entire mixed batches before effects", () => {
    for (const value of [
      null,
      {},
      "text",
      [],
      [null],
      [1],
      [[valid]],
      [{ command: valid.command }],
      [{ ...valid, extra: true }],
      [{ command: valid.command, args: [] }],
      [{ command: valid.command, args: "file:///tmp/x.eval" }],
      [{ command: valid.command, args: [null] }],
      [{ command: valid.command, args: [{ scheme: "file", path: "/x.eval" }] }],
      [{ command: valid.command, args: [...valid.args, true] }],
      [valid, { command: "inspect.runTask", args: [] }],
      Array.from({ length: 17 }, () => valid),
    ])
      assert.throws(() => parseCommandRequest(value));
  });

  test("rejects executable URIs, UNC targets and unsafe query semantics", () => {
    for (const target of [
      "command:workbench.action.terminal.new",
      "vscode://extension/command.eval",
      "javascript:alert(1)",
      "file://attacker/share/run.eval",
      "file:////attacker/share/run.eval",
      "file:///tmp/run.sh",
      "file:///tmp/run.eval#fragment",

      "file:///tmp/run.eval?epoch=-1",
      "file:///tmp/run.eval?epoch=1&epoch=2",
      "file:///tmp/run.eval?command=inspect.runTask",
      "file:///tmp/run.eval?sample_id=a&sample_id=b",
      "file:///tmp/run%00.eval",
      "file:///tmp/a%5Cb.eval",
      "https://user@attacker/run.eval",
      "https:///run.eval",
      "/tmp/run.eval",
      "file:///" + "a".repeat(8192) + ".eval",
    ])
      assert.throws(() => parseCommandRequest([request(target)]), target);
  });

  test("local logs need no prompt; unconfigured remote denial has no effects", async () => {
    let opened = 0;
    await handleCommandRequest([request("s3://bucket/run.eval")], {
      confirmRemote: () => Promise.resolve(false),
      openLog: () => {
        opened++;
        return Promise.resolve();
      },
    });
    assert.strictEqual(opened, 0);
    await handleCommandRequest([valid, request("s3://bucket/run.eval")], {
      confirmRemote: (targets) => {
        assert.strictEqual(targets.length, 1);
        return Promise.resolve(true);
      },
      openLog: () => {
        opened++;
        return Promise.resolve();
      },
    });
    assert.strictEqual(opened, 2);
  });

  test("normal local and configured remote requests open without a modal", async () => {
    const opened: string[] = [];
    await handleCommandRequest([valid, request("gs://bucket/logs/run.eval")], {
      trustedRoots: () => [Uri.parse("gs://bucket/logs")],
      confirmRemote: () => {
        assert.fail("unexpected confirmation");
      },
      openLog: (uri) => {
        opened.push(uri.toString());
        return Promise.resolve();
      },
    });
    assert.strictEqual(opened.length, 2);
  });

  test("preserves opaque sample IDs and trusted UNC workspaces", () => {
    const sample = "<sample>&\"'`";
    const target =
      "file:///tmp/run.eval?" +
      new URLSearchParams({ sample_id: sample, epoch: "1" }).toString();
    assert.strictEqual(
      new URLSearchParams(
        (parseCommandRequest([request(target)])[0] as Uri).query
      ).get("sample_id"),
      sample
    );
    const roots = [Uri.parse("file://server/share/work")];
    assert.strictEqual(
      parseCommandRequest([request("file://server/share/work/run.eval")], {
        trustedRoots: roots,
      }).length,
      1
    );
    for (const path of [
      "file://other/share/work/run.eval",
      "file://server/share/work/../run.eval",
      "file://server/share/work-evil/run.eval",
    ]) {
      assert.throws(() =>
        parseCommandRequest([request(path)], { trustedRoots: roots })
      );
    }
    for (const scheme of ["gs", "gcs", "az", "abfs", "abfss"])
      assert.strictEqual(
        parseCommandRequest([request(`${scheme}://bucket/run.eval`)]).length,
        1
      );
  });

  test("normalizes only unambiguous legacy Windows drive requests", () => {
    for (const target of [
      "C:\\logs\\run.eval?sample_id=one&epoch=1",
      "file://C%3A%5Clogs%5Crun.eval?sample_id=one&epoch=1",
    ]) {
      const result = parseCommandRequest([request(target)], {
        platform: "win32",
      })[0] as Uri;
      assert.strictEqual(result.path.toLowerCase(), "/c:/logs/run.eval");
      assert.strictEqual(
        new URLSearchParams(result.query).get("sample_id"),
        "one"
      );
    }
    assert.throws(() =>
      parseCommandRequest([request("file://server/share/run.eval")], {
        platform: "win32",
      })
    );
  });

  suite("isolated command files", () => {
    let dir: string;
    setup(() => {
      dir = mkdtempSync(join(tmpdir(), "inspect-command-test-"));
    });
    teardown(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test("consumes one producer file without deleting other pending requests", () => {
      const a = join(dir, "a");
      const b = join(dir, "b");
      writeFileSync(a, JSON.stringify([valid]));
      writeFileSync(b, JSON.stringify([valid]));
      assert.deepStrictEqual(readCommandFile(a, parseCommandRequest), [valid]);
      assert.throws(() => readFileSync(a));
      assert.deepStrictEqual(readCommandFile(b, parseCommandRequest), [valid]);
    });

    test("does not consume valid JSON that is not a valid command batch", () => {
      const file = join(dir, "not-a-request");
      for (const contents of [
        '{"important":"data"}',
        "[1,2,3]",
        '[{"command":"inspect.runTask","args":[]}]',
      ]) {
        writeFileSync(file, contents);
        assert.throws(() => readCommandFile(file, parseCommandRequest));
        assert.strictEqual(readFileSync(file, "utf8"), contents);
      }
    });

    test("refuses a replaced directory before consuming a request", () => {
      const commands = join(dir, "commands");
      mkdirSync(commands);
      const directory = new CommandDirectory(commands);
      renameSync(commands, join(dir, "original"));
      mkdirSync(commands);
      const file = join(commands, "keep");
      const contents = JSON.stringify([valid]);
      writeFileSync(file, contents);
      assert.throws(
        () =>
          readCommandFile(file, parseCommandRequest, () =>
            directory.assertUnchanged()
          ),
        /directory was replaced/
      );
      assert.strictEqual(readFileSync(file, "utf8"), contents);
    });

    test("partial writes remain available for a later bounded retry", () => {
      const file = join(dir, "partial");
      writeFileSync(file, "[");
      assert.throws(() => readCommandFile(file, parseCommandRequest));
      writeFileSync(file, JSON.stringify([valid]));
      assert.deepStrictEqual(readCommandFile(file, parseCommandRequest), [
        valid,
      ]);
    });

    test("rejects malformed and oversized files without dispatch", () => {
      const file = join(dir, "invalid");
      for (const contents of ["", "not json", "[" + " ".repeat(65536) + "]"]) {
        writeFileSync(file, contents);
        assert.throws(() => readCommandFile(file, parseCommandRequest));
      }
    });

    test("rejects a replacement introduced during validation without consuming it", () => {
      const file = join(dir, "request");
      writeFileSync(file, JSON.stringify([valid]));
      assert.throws(() =>
        readCommandFile(file, (value) => {
          parseCommandRequest(value);
          renameSync(file, join(dir, "original"));
          writeFileSync(file, "keep replacement");
        })
      );
      assert.strictEqual(readFileSync(file, "utf8"), "keep replacement");
    });

    test("descriptor validation rejects FIFOs without blocking", function () {
      if (process.platform === "win32") this.skip();
      const fifo = join(dir, "pipe");
      execFileSync("mkfifo", [fifo]);
      const reader = require.resolve("../../providers/inspect/command-file");
      const probe =
        "const {readCommandFile}=require(process.argv[1]); try {readCommandFile(process.argv[2],()=>{}); process.exit(1);} catch {process.exit(0);}";
      execFileSync("node", ["-e", probe, reader, fifo], { timeout: 3000 });
    });

    test("rejects directories and links without reading or removing their targets", function () {
      const target = join(dir, "target");
      const hard = join(dir, "hard");
      const symlink = join(dir, "symlink");
      writeFileSync(target, JSON.stringify([valid]));
      linkSync(target, hard);
      assert.throws(() => readCommandFile(hard, parseCommandRequest));
      rmSync(hard);
      const folder = join(dir, "folder");
      mkdirSync(folder);
      assert.throws(() => readCommandFile(folder, parseCommandRequest));
      // Windows symlink creation requires Developer Mode or elevated rights.
      if (process.platform !== "win32") {
        symlinkSync(target, symlink);
        assert.throws(() => readCommandFile(symlink, parseCommandRequest));
      }
      assert.strictEqual(readFileSync(target, "utf8"), JSON.stringify([valid]));
    });
  });
});
