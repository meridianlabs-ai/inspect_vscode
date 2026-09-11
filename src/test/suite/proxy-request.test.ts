import * as assert from "assert";

import { ExtensionContext, Uri } from "vscode";

import { parseProxyRequest } from "../../core/package/proxy-request";
import { HostWebviewPanel } from "../../hooks";
import { InspectViewServer } from "../../providers/inspect/inspect-view-server";
import { LogviewPanel } from "../../providers/logview/logview-panel";
import { ScanviewPanel } from "../../providers/scanview/scanview-panel";
import { ScoutViewServer } from "../../providers/scout/scout-view-server";

const enc = encodeURIComponent;
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const C1 = String.fromCharCode(1);

/** A webview host that lets a test send JSON-RPC requests like injected script. */
function webview() {
  const handlers = new Set<(data: unknown) => void>();
  let receive: (value: {
    error?: unknown;
    result?: unknown;
  }) => void = () => {};
  const panel = {
    webview: {
      onDidReceiveMessage: (handler: (data: unknown) => void) => {
        handlers.add(handler);
        return { dispose: () => handlers.delete(handler) };
      },
      postMessage: (data: { error?: unknown; result?: unknown }) =>
        receive(data),
    },
  } as unknown as HostWebviewPanel;
  return {
    panel,
    request: (method: string, params: unknown[]) =>
      new Promise<{ error?: unknown; result?: unknown }>((resolve) => {
        receive = resolve;
        for (const handler of handlers)
          handler({ jsonrpc: "2.0", id: 1, method, params });
      }),
  };
}

/** Records what reaches `proxyRpcRequest`; nothing here contacts a server. */
function proxySpy() {
  const forwarded: unknown[] = [];
  return {
    forwarded,
    proxyRpcRequest: (request: unknown) => {
      forwarded.push(request);
      return Promise.resolve({ status: 200, headers: {}, body: "ok" });
    },
  };
}

// Method spellings that fetch would silently normalize to DELETE.
const kDeleteSpellings = ["DELETE", "delete", "Delete", "dElEtE"];

// Requests outside the proxy contract: not the shape the proxy promises, a
// method the route policy cannot compare exactly, a path that could not be
// appended to the extension-chosen origin, or a header the extension host
// owns. Each must fail at the RPC boundary, before any policy or server contact.
const malformed = (path: string) => [
  { method: "GET", path: path.replace(/^\//, "") }, // missing leading slash
  { method: "GET X", path }, // not a supported method token
  { method: "PATCH", path }, // unsupported method
  { method: ["GET"], path }, // non-string method
  { method: "GET", path, headers: { Authorization: "token" } }, // host-owned
  { method: "GET", path, headers: { Host: "evil" } }, // host-owned
  { method: "GET", path, headers: ["test"] }, // non-object headers
  { method: "GET", path, headers: { Accept: 1 } }, // non-string header value
  { method: "POST", path, body: {} }, // non-string body
  "not an object",
  null,
  [],
];

suite("webview http_request validation at the RPC boundary", () => {
  test("log view rejects every DELETE spelling and malformed request before forwarding", async () => {
    const view = webview();
    const spy = proxySpy();
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      spy as unknown as InspectViewServer,
      "dir",
      Uri.file("/w/logs")
    );
    try {
      const inScope = enc("file:///w/logs/run.eval");
      for (const method of kDeleteSpellings) {
        for (const path of [
          `/api/logs/${inScope}`,
          `/api/log-delete/${inScope}`,
          "/api/log-dir",
        ]) {
          const response = await view.request("http_request", [
            { method, path },
          ]);
          assert.ok(response.error, `${method} ${path}`);
        }
      }
      for (const request of malformed("/api/log-dir")) {
        const response = await view.request("http_request", [request]);
        assert.ok(response.error, JSON.stringify(request));
      }
      assert.deepStrictEqual(spy.forwarded, []);

      // Legitimate viewer traffic still flows, with the method preserved.
      const allowed = [
        { method: "GET", path: "/api/log-dir" },
        { method: "HEAD", path: "/api/dist" },
        {
          method: "GET",
          path: `/api/log-bytes/${inScope}`,
          headers: { Accept: "application/octet-stream", Range: "bytes=0-9" },
        },
        {
          method: "POST",
          path: `/api/log-message?log_file=${inScope}`,
          headers: { "Content-Type": "application/json" },
          body: '{"message":"hi"}',
        },
      ];
      for (const request of allowed) {
        const response = await view.request("http_request", [request]);
        assert.strictEqual(response.error, undefined, JSON.stringify(request));
        assert.deepStrictEqual(response.result, {
          status: 200,
          headers: {},
          body: "ok",
        });
      }
      assert.deepStrictEqual(spy.forwarded, allowed);

      // A null body from a fetch-style init is forwarded as no body.
      const nullBody = await view.request("http_request", [
        { method: "GET", path: "/api/log-dir", body: null },
      ]);
      assert.strictEqual(nullBody.error, undefined);
      assert.deepStrictEqual(spy.forwarded.at(-1), {
        method: "GET",
        path: "/api/log-dir",
      });
    } finally {
      panel.dispose();
    }
  });

  for (const [label, scope] of [
    ["full scan view", undefined],
    // The custom editor passes the directory holding its scan.
    ["single-scan editor", () => [Uri.file("/w/scans")]],
  ] as const) {
    test(`${label} rejects every DELETE spelling and malformed request before forwarding`, async () => {
      const view = webview();
      const spy = proxySpy();
      const server = {
        ...spy,
        legacy: {},
        // An explicit panel scope must be used instead of this default.
        scanResultsScope: () => (scope ? [] : [Uri.file("/w/scans")]),
        transcriptsScope: () => [Uri.parse("s3://team/transcripts")],
      } as unknown as ScoutViewServer;
      const panel = new ScanviewPanel(
        view.panel,
        {} as ExtensionContext,
        server,
        scope
      );
      try {
        const dir = b64("/w/scans");
        const scan = b64("scan_id=own");
        const legacy = enc("/w/scans/scan_id=own");
        for (const method of kDeleteSpellings) {
          for (const path of [
            `/api/v2/scans/${dir}/${scan}`,
            `/api/scan-delete/${legacy}`,
            `/api/scan/${legacy}`,
            "/api/v2/project/config",
          ]) {
            const response = await view.request("http_request", [
              { method, path },
            ]);
            assert.ok(response.error, `${method} ${path}`);
          }
        }
        for (const request of malformed(`/api/v2/scans/${dir}/${scan}`)) {
          const response = await view.request("http_request", [request]);
          assert.ok(response.error, JSON.stringify(request));
        }
        assert.deepStrictEqual(spy.forwarded, []);

        const allowed = [
          { method: "GET", path: `/api/v2/scans/${dir}/${scan}` },
          { method: "GET", path: `/api/scan/${legacy}` },
          {
            method: "POST",
            path: `/api/v2/scans/${dir}/${scan}/scanner`,
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
          // The Scout viewer probes transcript existence with HEAD.
          {
            method: "HEAD",
            path: `/api/v2/transcripts/${b64("s3://team/transcripts")}/tid/info`,
          },
          // Validation cases are project files the viewer creates and deletes;
          // that route keeps its existing DELETE allowance.
          {
            method: "DELETE",
            path: `/api/v2/validations/${b64("file:///w/validation.json")}`,
          },
        ];
        for (const request of allowed) {
          const response = await view.request("http_request", [request]);
          assert.strictEqual(
            response.error,
            undefined,
            JSON.stringify(request)
          );
        }
        assert.deepStrictEqual(spy.forwarded, allowed);
      } finally {
        panel.dispose();
      }
    });
  }

  test("a scope guard that throws synchronously still answers the webview", async () => {
    const view = webview();
    const spy = proxySpy();
    let searched = 0;
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      {
        ...spy,
        postSearch: () => {
          searched++;
          return Promise.resolve("searched");
        },
      } as unknown as InspectViewServer,
      "dir",
      Uri.file("/w/logs")
    );
    try {
      // post_search is not an async handler, so its guard throws before any
      // promise exists. The webview must still get a JSON-RPC error response.
      const response = await view.request("post_search", [
        "/etc",
        "events",
        {},
      ]);
      assert.ok(response.error);
      assert.strictEqual(searched, 0);
      const ok = await view.request("post_search", ["/w/logs", "events", {}]);
      assert.strictEqual(ok.result, "searched");
    } finally {
      panel.dispose();
    }
  });
});

suite("parseProxyRequest", () => {
  test("returns only the known fields of a well-formed request", () => {
    assert.deepStrictEqual(
      parseProxyRequest({ method: "GET", path: "/api/log-dir", extra: 1 }),
      { method: "GET", path: "/api/log-dir" }
    );
    assert.deepStrictEqual(
      parseProxyRequest({
        method: "POST",
        path: "/api/log-message?log_file=x",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      {
        method: "POST",
        path: "/api/log-message?log_file=x",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      assert.strictEqual(
        parseProxyRequest({ method, path: "/api/x" }).method,
        method
      );
    }
    // A fetch-style init defaults body to null; that means "no body", even on
    // GET and HEAD, and is dropped from the parsed request.
    for (const method of ["GET", "HEAD", "POST"]) {
      assert.deepStrictEqual(
        parseProxyRequest({ method, path: "/api/x", body: null }),
        { method, path: "/api/x" }
      );
    }
    // Percent-encoding, query strings and tab-free printable values pass.
    assert.doesNotThrow(() =>
      parseProxyRequest({
        method: "GET",
        path: `/api/log-bytes/${enc("file:///w/my logs/run.eval")}?start=0`,
        headers: { Range: "bytes=0-9", "If-None-Match": '"etag"' },
      })
    );
  });

  test("rejects method spellings that fetch would normalize, and unknown methods", () => {
    for (const method of [
      "delete",
      "Delete",
      "dElEtE",
      "get",
      "Post",
      "GET X",
      " GET",
      "PATCH",
      "OPTIONS",
      "TRACE",
      "",
      1,
      undefined,
      ["GET"],
    ]) {
      assert.throws(
        () => parseProxyRequest({ method, path: "/api/x" }),
        /Invalid proxied method/,
        String(method)
      );
    }
  });

  test("rejects malformed shapes, relative paths, non-string bodies and host-owned headers", () => {
    for (const value of [undefined, null, "GET /api/x", 1, [], () => {}]) {
      assert.throws(() => parseProxyRequest(value), /Invalid proxied request/);
    }
    for (const path of [
      "api/x",
      "",
      "127.0.0.1:1/api/x",
      "http://127.0.0.1/api/x",
      undefined,
      ["/api/x"],
    ]) {
      assert.throws(
        () => parseProxyRequest({ method: "GET", path }),
        /Invalid proxied path/,
        String(path)
      );
    }
    for (const body of [{}, 1, ["x"], true]) {
      assert.throws(
        () => parseProxyRequest({ method: "POST", path: "/api/x", body }),
        /Invalid proxied body/
      );
    }
    for (const headers of [
      null,
      "Accept: x",
      ["Accept"],
      { Accept: 1 },
      { Accept: null },
      { Authorization: "token" },
      { authorization: "token" },
      { Host: "evil" },
      { host: "evil" },
    ]) {
      assert.throws(
        () => parseProxyRequest({ method: "GET", path: "/api/x", headers }),
        /Invalid proxied headers/,
        JSON.stringify(headers)
      );
    }
  });

  test("leaves transport rules to fetch instead of predicting them", () => {
    // These are not part of the proxy contract. If fetch or undici refuses
    // one, that single request fails with a JSON-RPC error (see the view
    // server lifecycle tests); nothing here needs to guess in advance.
    for (const request of [
      { method: "GET", path: "/api/x", body: "x" },
      { method: "HEAD", path: "/api/x", body: "" },
      { method: "GET", path: "/api/x y#frag" },
      { method: "GET", path: "/other" },
      { method: "GET", path: "/api/x", headers: { "bad name": "x" } },
      { method: "GET", path: "/api/x", headers: { test: "x\ny" } },
      { method: "GET", path: "/api/x", headers: { test: `x${C1}y` } },
      { method: "GET", path: "/api/x", headers: { "Keep-Alive": "timeout=5" } },
      { method: "GET", path: "/api/x", headers: { "Content-Length": "1" } },
    ]) {
      assert.doesNotThrow(
        () => parseProxyRequest(request),
        JSON.stringify(request)
      );
    }
  });
});
