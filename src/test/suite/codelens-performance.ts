import * as assert from "assert";
import { Worker } from "worker_threads";

// Exercise the actual compiled provider in a disposable worker. These inputs
// have no import, so the only document API used is getText; no VS Code runtime
// objects are needed. Functional tests still run against VS Code in the host.
export async function assertBoundedCodeLensScan(
  providerPath: string,
  providerExport: string
): Promise<void> {
  const worker = new Worker(
    `
      const { parentPort, workerData } = require('worker_threads');
      const { performance } = require('perf_hooks');
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(id, ...args) {
        return id === 'vscode' ? {} : originalLoad.call(this, id, ...args);
      };
      const Provider = require(workerData.providerPath)[workerData.providerExport];
      const results = [];
      for (const size of [128_000, 1_000_000, 4_000_000]) {
        const text = '('.repeat(size);
        const start = performance.now();
        const lenses = new Provider().provideCodeLenses(
          { getText: () => text }, { isCancellationRequested: false }
        );
        results.push({ lenses, elapsed: performance.now() - start });
      }
      parentPort.postMessage(results);
    `,
    { eval: true, workerData: { providerPath, providerExport } }
  );
  try {
    const results = await new Promise<{ lenses: unknown[]; elapsed: number }[]>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("CodeLens scan exceeded 5 seconds")),
          5_000
        );
        worker.once(
          "message",
          (result: { lenses: unknown[]; elapsed: number }[]) => {
            clearTimeout(timeout);
            resolve(result);
          }
        );
        worker.once("error", (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.once("exit", (code) => {
          clearTimeout(timeout);
          reject(
            new Error(`CodeLens worker exited before its result (${code})`)
          );
        });
      }
    );
    assert.strictEqual(results.length, 3);
    for (const { lenses, elapsed } of results) {
      assert.deepStrictEqual(lenses, []);
      assert.ok(elapsed < 1_000, `import detection took ${elapsed}ms`);
    }
  } finally {
    await worker.terminate();
  }
}
