import * as assert from "node:assert";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Uri } from "vscode";

import { readCommandFile } from "../../providers/inspect/command-file";
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

  test("reproduces the old dispatcher premise using only recorded effects", async () => {
    const effects: string[] = [];
    const batch = [
      { command: "workbench.action.terminal.new", args: [] },
      {
        command: "workbench.action.terminal.sendSequence",
        args: [{ text: "marker" }],
      },
    ];
    // Model the old loop without calling VS Code or touching the real IPC dir.
    for (const entry of batch) effects.push(entry.command);
    assert.strictEqual(effects.length, 2);
    effects.length = 0;
    await assert.rejects(
      handleCommandRequest(batch, {
        confirm: () => {
          throw new Error("must not prompt");
        },
        openLog: (uri) => {
          effects.push(uri.toString());
          return Promise.resolve();
        },
      })
    );
    assert.deepStrictEqual(effects, []);
  });

  test("accepts producer log and sample requests on supported backends", () => {
    for (const target of [
      "file:///tmp/a%20log.json",
      "file:///C:/logs/run.eval",
      "file:///home/user/logs/run.eval?sample_id=hello+world&epoch=1",
      "s3://bucket/logs/run.eval?sample_id=42&epoch=2",
      "https://example.com/logs/run.json",
      "http://localhost:7575/logs/run.eval",
    ]) {
      assert.deepStrictEqual(
        parseCommandRequest([request(target)]).map((uri) => uri.toString()),
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
          confirm: () => {
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
      "file:///tmp/run.eval?sample_id=%3Cscript%3E&epoch=1",
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

  test("a valid unauthenticated file has no effect without explicit user consent", async () => {
    let opened = 0;
    await handleCommandRequest([valid], {
      confirm: () => Promise.resolve(false),
      openLog: () => {
        opened++;
        return Promise.resolve();
      },
    });
    assert.strictEqual(opened, 0);
    await handleCommandRequest([valid, request("s3://bucket/run.eval")], {
      confirm: (targets) => {
        assert.strictEqual(targets.length, 2);
        return Promise.resolve(true);
      },
      openLog: () => {
        opened++;
        return Promise.resolve();
      },
    });
    assert.strictEqual(opened, 2);
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
      assert.deepStrictEqual(readCommandFile(a), [valid]);
      assert.throws(() => readFileSync(a));
      assert.deepStrictEqual(readCommandFile(b), [valid]);
    });

    test("partial writes remain available for a later bounded retry", () => {
      const file = join(dir, "partial");
      writeFileSync(file, "[");
      assert.throws(() => readCommandFile(file));
      writeFileSync(file, JSON.stringify([valid]));
      assert.deepStrictEqual(readCommandFile(file), [valid]);
    });

    test("rejects malformed and oversized files without dispatch", () => {
      const file = join(dir, "invalid");
      for (const contents of ["", "not json", "[" + " ".repeat(65536) + "]"]) {
        writeFileSync(file, contents);
        assert.throws(() => readCommandFile(file));
      }
    });

    test("rejects directories and links without reading or removing their targets", function () {
      const target = join(dir, "target");
      const hard = join(dir, "hard");
      const symlink = join(dir, "symlink");
      writeFileSync(target, JSON.stringify([valid]));
      linkSync(target, hard);
      assert.throws(() => readCommandFile(hard));
      rmSync(hard);
      const folder = join(dir, "folder");
      mkdirSync(folder);
      assert.throws(() => readCommandFile(folder));
      // Windows symlink creation requires Developer Mode or elevated rights.
      if (process.platform !== "win32") {
        symlinkSync(target, symlink);
        assert.throws(() => readCommandFile(symlink));
      }
      assert.strictEqual(readFileSync(target, "utf8"), JSON.stringify([valid]));
    });
  });
});
