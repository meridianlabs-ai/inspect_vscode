import * as assert from "assert";
import { Worker } from "worker_threads";

import { workspaceTaskNames } from "../../providers/workspace/workspace-task-names";

suite("Workspace task discovery", () => {
  test("preserves plain, parameterized, multiline, and indented tasks", () => {
    const text = [
      "@task",
      "def plain(): pass",
      "@task(name='example')",
      "def parameterized(): pass",
      "@task(",
      "    name='example',",
      ")",
      "def multiline(): pass",
      "    @task()",
      "    def indented (): pass",
    ].join("\r\n");
    assert.deepStrictEqual(workspaceTaskNames(text), [
      "plain",
      "parameterized",
      "multiline",
      "indented",
    ]);
  });

  test("rejects non-task decorators, intervening statements, and unsafe names", () => {
    for (const text of [
      "@task_other\ndef other(): pass",
      "# @task\ndef commented(): pass",
      "@task\n# comment\ndef separated(): pass",
      "@task\ndef bad;name(): pass",
      "@task(\ndef unclosed(): pass",
    ]) {
      assert.deepStrictEqual(workspaceTaskNames(text), [], text);
    }
  });

  test("recovers later tasks after incomplete or unmatched decorators", () => {
    assert.deepStrictEqual(
      workspaceTaskNames("@task(\n@task\ndef recovered(): pass"),
      ["recovered"]
    );
    assert.deepStrictEqual(
      workspaceTaskNames("@task(\n) invalid\n@task()\ndef recovered(): pass"),
      ["recovered"]
    );
  });

  test("matches the previous discovery syntax on small generated fixtures", () => {
    const previous =
      /^[ \t]*@task(?:\([^)]*\))?[ \t]*\r?\n[ \t]*def\s+([A-Za-z_]\w*)\s*\(/gm;
    const fragments = [
      "@task",
      "@task(",
      ")",
      "def example():",
      " ",
      "\n",
      "\r\n",
      "# comment",
      "@task()",
    ];
    let seed = 42;
    for (let i = 0; i < 1_000; i++) {
      let text = "";
      for (let j = 0; j < 30; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        text += fragments[seed % fragments.length];
      }
      assert.deepStrictEqual(
        workspaceTaskNames(text),
        Array.from(text.matchAll(previous), (match) => match[1]),
        text
      );
    }
  });

  test("multi-megabyte adversarial inputs finish within a bounded time", async function () {
    this.timeout(10_000);
    // Isolate synchronous parsing so a regression can be terminated, rather
    // than freezing the test extension host before Mocha can time out.
    const worker = new Worker(
      `
      const { parentPort } = require('worker_threads');
      const { performance } = require('perf_hooks');
      const { workspaceTaskNames } = require(${JSON.stringify(require.resolve("../../providers/workspace/workspace-task-names"))});
      const timings = [];
      for (const count of [50_000, 100_000, 400_000]) {
        for (const suffix of ['', ')\\n' + ' '.repeat(count) + 'invalid', ')\\ndef valid():']) {
          const text = '@task(\\n'.repeat(count) + suffix;
          const start = performance.now();
          const names = workspaceTaskNames(text);
          if (JSON.stringify(names) !== JSON.stringify(suffix.endsWith('valid():') ? ['valid'] : [])) {
            throw new Error('Unexpected task names');
          }
          timings.push(performance.now() - start);
        }
      }
      parentPort.postMessage(timings);
    `,
      { eval: true }
    );
    try {
      const timings = await new Promise<number[]>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("workspace scan exceeded 5 seconds")),
          5_000
        );
        worker.once("message", (result: number[]) => {
          clearTimeout(timeout);
          resolve(result);
        });
        worker.once("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.once("exit", (code) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `workspace scan worker exited before its result (${code})`
            )
          );
        });
      });
      assert.ok(
        timings.every((time) => time < 1_000),
        `scan times: ${timings.join(", ")}`
      );
    } finally {
      await worker.terminate();
    }
  });
});
