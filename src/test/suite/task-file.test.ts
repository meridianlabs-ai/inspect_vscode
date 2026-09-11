import * as assert from "assert";
import fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Worker } from "worker_threads";

import {
  createTaskFile,
  taskFileExists,
  taskFileName,
} from "../../core/task-file";

suite("Create Task filesystem boundary", () => {
  let fixture: string;
  let root: string;
  setup(() => {
    fixture = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "create-task-")));
    root = join(fixture, "workspace");
    fs.mkdirSync(root);
  });
  teardown(() => fs.rmSync(fixture, { recursive: true, force: true }));

  test("normalizes the exact target and preserves an existing user's edits", () => {
    assert.strictEqual(taskFileName("Task"), "task.py");
    const target = createTaskFile(root, "Task", "template");
    assert.strictEqual(target, join(root, "task.py"));
    assert.strictEqual(fs.readFileSync(target, "utf8"), "template");
    fs.writeFileSync(target, "user edits");
    assert.ok(taskFileExists(root, "Task"));
    assert.throws(() => createTaskFile(root, "TASK", "replacement"));
    assert.strictEqual(fs.readFileSync(target, "utf8"), "user edits");
    for (const name of ["../task", "a/b", "a\\b", "Class", ""])
      assert.throws(() => taskFileName(name));
  });

  for (const dangling of [false, true]) {
    test(`refuses ${dangling ? "dangling" : "existing"} symlinks for both input cases`, function () {
      const outside = join(fixture, "outside.py");
      if (!dangling) fs.writeFileSync(outside, "outside stays unchanged");
      try {
        fs.symlinkSync(outside, join(root, "task.py"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") this.skip();
        throw error;
      }
      for (const input of ["task", "Task"]) {
        assert.ok(taskFileExists(root, input));
        assert.throws(() => createTaskFile(root, input, "template"));
      }
      assert.strictEqual(fs.existsSync(outside), !dangling);
      if (!dangling)
        assert.strictEqual(
          fs.readFileSync(outside, "utf8"),
          "outside stays unchanged"
        );
      assert.ok(fs.lstatSync(join(root, "task.py")).isSymbolicLink());
    });
  }

  test("a link arriving after the existence check cannot redirect exclusive creation", function () {
    const outside = join(fixture, "outside.py");
    fs.writeFileSync(outside, "outside stays unchanged");
    // Check symlink support before replacing openSync.
    try {
      fs.symlinkSync(outside, join(root, "probe"));
      fs.unlinkSync(join(root, "probe"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") this.skip();
      throw error;
    }
    const originalOpen = fs.openSync;
    Object.assign(fs, {
      openSync: (path: fs.PathLike, flags: fs.OpenMode) => {
        fs.symlinkSync(outside, join(root, "task.py"));
        return originalOpen(path, flags);
      },
    });
    try {
      assert.throws(() => createTaskFile(root, "Task", "template"), /EEXIST/);
    } finally {
      Object.assign(fs, { openSync: originalOpen });
    }
    assert.strictEqual(
      fs.readFileSync(outside, "utf8"),
      "outside stays unchanged"
    );
  });

  test("a workspace root replaced before creation is refused without outside writes", function () {
    const outside = join(fixture, "outside");
    fs.mkdirSync(outside);
    fs.renameSync(root, root + "-original");
    try {
      fs.symlinkSync(outside, root, "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") this.skip();
      throw error;
    }
    assert.throws(() => createTaskFile(root, "task", "template"));
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });

  test("concurrent creation has one winner and never overwrites its content", async () => {
    const gate = new SharedArrayBuffer(4);
    const workers = ["first", "second"].map(
      (content) =>
        new Worker(
          `
      const {parentPort, workerData} = require('worker_threads');
      const {createTaskFile} = require(workerData.module);
      parentPort.postMessage('ready');
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      try { createTaskFile(workerData.root, 'Task', workerData.content); parentPort.postMessage({won: true, content: workerData.content}); }
      catch (e) { parentPort.postMessage({won: false, code: e.code}); }
    `,
          {
            eval: true,
            workerData: {
              gate,
              root,
              content,
              module: join(__dirname, "../../core/task-file.js"),
            },
          }
        )
    );
    try {
      const outcomes = workers.map(
        (worker) =>
          new Promise<{ won: boolean; content?: string }>((resolve, reject) => {
            worker.on("error", reject);
            worker.on("message", (message: unknown) => {
              if (message !== "ready")
                resolve(message as { won: boolean; content?: string });
            });
          })
      );
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      const results = await Promise.all(outcomes);
      assert.strictEqual(results.filter((result) => result.won).length, 1);
      assert.strictEqual(
        fs.readFileSync(join(root, "task.py"), "utf8"),
        results.find((result) => result.won)!.content
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  });
});
