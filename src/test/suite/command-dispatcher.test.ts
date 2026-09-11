import * as assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandRequestActions } from "../../providers/inspect/command-request";
import {
  InspectCommandDispatcher,
  isDirectCommandFile,
} from "../../providers/inspect/inspect-commands";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "timed out waiting for dispatcher");
    await pause(25);
  }
}
const request = JSON.stringify([
  { command: "inspect.openLogViewer", args: ["file:///tmp/run.eval"] },
]);

suite("Command dispatcher", function () {
  this.timeout(10000);
  let dir: string;
  let dispatcher: InspectCommandDispatcher | undefined;
  setup(() => {
    dir = mkdtempSync(join(tmpdir(), "inspect-dispatch-"));
  });
  teardown(() => {
    dispatcher?.dispose();
    dispatcher = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function startDispatcher(
    actions: CommandRequestActions,
    rejected: (message: string) => void
  ) {
    let ready = false;
    dispatcher = new InspectCommandDispatcher(
      dir,
      {
        ...actions,
        confirm: (targets) => {
          if (
            targets.length === 1 &&
            targets[0]?.path === "/__ipc_ready__.eval"
          ) {
            ready = true;
            return Promise.resolve(false);
          }
          return actions.confirm(targets);
        },
      },
      rejected
    );
    // VS Code's watcher utility process starts asynchronously, especially on
    // Windows CI. Observe a real probe; a fixed sleep cannot establish readiness.
    const probe = JSON.stringify([
      {
        command: "inspect.openLogViewer",
        args: ["file:///__ipc_ready__.eval"],
      },
    ]);
    const deadline = Date.now() + 5000;
    while (!ready) {
      assert.ok(Date.now() < deadline, "command watcher did not become ready");
      writeFileSync(join(dir, "ready-probe"), probe);
      await pause(100);
    }
  }

  test("matches Windows watcher paths without trusting sibling directories", () => {
    assert.ok(
      isDirectCommandFile(
        "C:\\Users\\me\\commands",
        "c:\\Users\\me\\commands\\a",
        "win32"
      )
    );
    assert.ok(
      isDirectCommandFile(
        "C:\\USERS\\me\\commands",
        "c:\\Users\\me\\commands\\a",
        "win32"
      )
    );
    assert.ok(
      !isDirectCommandFile(
        "C:\\Users\\me\\commands",
        "c:\\Users\\me\\commands-other\\a",
        "win32"
      )
    );
    assert.ok(
      !isDirectCommandFile(
        "C:\\Users\\me\\commands",
        "d:\\Users\\me\\commands\\a",
        "win32"
      )
    );
    assert.ok(
      !isDirectCommandFile("/tmp/commands", "/tmp/commands/sub/a", "linux")
    );
    assert.ok(
      !isDirectCommandFile("/tmp/commands", "/tmp/commands/../a", "linux")
    );
  });

  test("cleans stale files without parsing, prompting or opening them", () => {
    const file = join(dir, "stale");
    writeFileSync(file, request);
    dispatcher = new InspectCommandDispatcher(
      dir,
      {
        confirm: () => {
          assert.fail("stale request prompted");
        },
        openLog: () => {
          assert.fail("stale request opened");
        },
      },
      () => {
        assert.fail("unexpected rejection");
      }
    );
    assert.strictEqual(existsSync(file), false);
  });

  test("refuses a symlinked command directory without deleting its target", () => {
    const target = join(dir, "target");
    const link = join(dir, "commands");
    mkdirSync(target);
    writeFileSync(join(target, "keep"), "important data");
    symlinkSync(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.throws(
      () =>
        new InspectCommandDispatcher(link, {
          confirm: () => {
            assert.fail("unexpected prompt");
          },
          openLog: () => {
            assert.fail("unexpected open");
          },
        }),
      /Unsafe Inspect command directory/
    );
    assert.strictEqual(
      readFileSync(join(target, "keep"), "utf8"),
      "important data"
    );
  });

  test("real watcher handles partial writes and multiple files without replay", async () => {
    const opened: string[] = [];
    const rejected: string[] = [];
    await startDispatcher(
      {
        confirm: () => Promise.resolve(true),
        openLog: (uri) => {
          opened.push(uri.toString());
          return Promise.resolve();
        },
      },
      (message) => {
        rejected.push(message);
      }
    );
    const first = join(dir, "first");
    writeFileSync(first, "[");
    await pause(100);
    writeFileSync(first, request);
    writeFileSync(join(dir, "second"), request);
    await waitUntil(() => opened.length === 2);
    await pause(500); // late duplicate create/change events must be harmless
    assert.strictEqual(opened.length, 2);
    assert.deepStrictEqual(rejected, []);
    assert.strictEqual(existsSync(first), false);
    assert.strictEqual(existsSync(join(dir, "second")), false);
  });

  test("invalid mixed batches notify without prompting or opening", async () => {
    const rejected: string[] = [];
    await startDispatcher(
      {
        confirm: () => {
          assert.fail("invalid batch prompted");
        },
        openLog: () => {
          assert.fail("invalid batch opened");
        },
      },
      (message) => {
        rejected.push(message);
      }
    );
    writeFileSync(
      join(dir, "invalid"),
      JSON.stringify([
        { command: "inspect.openLogViewer", args: ["file:///tmp/run.eval"] },
        { command: "workbench.action.terminal.new", args: [] },
      ])
    );
    await waitUntil(() => rejected.length === 1);
    assert.match(rejected[0]!, /Only inspect.openLogViewer/);
    assert.match(rejected[0]!, /command palette/);
  });

  test("disposing while confirmation is pending prevents effects", async () => {
    let prompted = false;
    let confirm!: (value: boolean) => void;
    const decision = new Promise<boolean>((resolve) => {
      confirm = resolve;
    });
    await startDispatcher(
      {
        confirm: () => {
          prompted = true;
          return decision;
        },
        openLog: () => {
          assert.fail("disposed dispatcher opened a log");
        },
      },
      () => {
        assert.fail("unexpected rejection");
      }
    );
    writeFileSync(join(dir, "pending"), request);
    await waitUntil(() => prompted);
    dispatcher!.dispose();
    confirm(true);
    await pause(100);
  });
});
