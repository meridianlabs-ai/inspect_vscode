import * as assert from "assert";

import {
  jsonRpcPostMessageServer,
  JsonRpcServerMethod,
} from "../../core/jsonrpc";

suite("jsonRpcPostMessageServer", () => {
  function target() {
    const handlers = new Set<(data: unknown) => void>();
    const posted: Array<{ id: number; result?: unknown; error?: unknown }> = [];
    return {
      posted,
      target: {
        postMessage: (data: unknown) =>
          posted.push(
            data as { id: number; result?: unknown; error?: unknown }
          ),
        onMessage: (handler: (data: unknown) => void) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
      send: (id: number, method: string, params?: unknown[]) => {
        for (const handler of handlers)
          handler({ jsonrpc: "2.0", id, method, params });
      },
    };
  }

  test("a method that throws synchronously answers with a JSON-RPC error", async () => {
    const { posted, target: t, send } = target();
    jsonRpcPostMessageServer(t, {
      sync: (() => {
        throw new Error("rejected before any promise");
      }) as unknown as JsonRpcServerMethod,
      ok: () => Promise.resolve("fine"),
    });
    // The webview must receive a response either way; an exception escaping
    // the message handler would leave its request pending forever.
    assert.doesNotThrow(() => send(1, "sync"));
    send(2, "ok");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(posted.length, 2);
    const failed = posted.find((message) => message.id === 1)!;
    assert.match(
      (failed.error as { message: string }).message,
      /rejected before any promise/
    );
    assert.strictEqual(
      posted.find((message) => message.id === 2)!.result,
      "fine"
    );
  });
});
