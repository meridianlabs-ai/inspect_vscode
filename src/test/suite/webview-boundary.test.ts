import * as assert from "assert";

import { ExtensionContext, Uri } from "vscode";

import { locationInScope } from "../../core/package/location-scope";
import { HostWebviewPanel } from "../../hooks";
import { InspectViewServer } from "../../providers/inspect/inspect-view-server";
import { LogviewPanel } from "../../providers/logview/logview-panel";
import { captureProjectAuthority } from "../../providers/scanview/project-authority";
import { ScanviewPanel } from "../../providers/scanview/scanview-panel";
import { normalizeScoutProjectConfig } from "../../providers/scout/scout-project";
import { ScoutViewServer } from "../../providers/scout/scout-view-server";

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

const enc = encodeURIComponent;
const b64 = (s: string) => Buffer.from(s).toString("base64url");

suite("Webview boundary RPC integration", () => {
  test("legacy results authority is captured before applying scans defaults", () => {
    const config = normalizeScoutProjectConfig({ results: "/external/scans" });
    const authority = captureProjectAuthority(config, (location) =>
      Uri.file(location)
    );
    assert.ok(locationInScope(authority.scans, "/external/scans/run"));
    assert.ok(!locationInScope(authority.scans, "/other/run"));
    assert.strictEqual(normalizeScoutProjectConfig({}).scans, "./scans");
    assert.strictEqual(
      normalizeScoutProjectConfig({ scans: null }).scans,
      null
    );
    assert.strictEqual(
      normalizeScoutProjectConfig({ results: null }).scans,
      null
    );
  });
  test("project edits cannot broaden captured authority, including filesystem and bucket roots", () => {
    const config = { transcripts: "s3://team/logs", scans: "file:///w/scans" };
    const authority = captureProjectAuthority(config, (location) =>
      Uri.parse(location)
    );
    config.transcripts = "file:///";
    config.scans = "file:///";
    assert.ok(locationInScope(authority.transcripts, "s3://team/logs/run"));
    assert.ok(!locationInScope(authority.transcripts, "/outside"));
    assert.ok(!locationInScope(authority.scans, "/outside"));
    for (const transcripts of [
      "file:///",
      "file:///w/../",
      "file:///C:/",
      "s3://team/",
    ]) {
      assert.deepStrictEqual(
        captureProjectAuthority({ transcripts }, (location) =>
          Uri.parse(location)
        ).transcripts,
        []
      );
    }
  });

  test("decoded locations retain delimiter path data, Windows separators and remote identity", () => {
    const root = Uri.parse("file:///C:/logs");
    for (const location of [
      "C:\\logs\\..%2Foutside",
      "file:///C:/logs/x%23/../../outside",
      "file:///C:/logs/x%3F/../../outside",
    ]) {
      assert.ok(!locationInScope([root], location, { decode: true }));
    }
    assert.ok(
      locationInScope([root], "C:\\logs\\with%20space.eval", { decode: true })
    );
    assert.ok(
      locationInScope([Uri.parse("s3://team/logs")], "s3://team/logs/a%20b", {
        decode: true,
      })
    );
    assert.ok(
      !locationInScope([Uri.parse("s3://team/logs")], "s3://other/logs/a", {
        decode: true,
      })
    );
    assert.ok(
      !locationInScope(
        [Uri.parse("s3://team/logs")],
        "s3://team/logs/x%23/../../outside",
        { decode: true }
      )
    );
    assert.ok(
      locationInScope([Uri.file("/w/100%.eval")], "/w/100%25.eval", {
        decode: true,
        exact: true,
      })
    );
  });
  test("full view validates configuration bodies and retains external transcript authority", async () => {
    const view = webview();
    let calls = 0;
    const server = {
      legacy: {},
      proxyRpcRequest: () => {
        calls++;
        return Promise.resolve("ok");
      },
      scanResultsScope: () => [Uri.file("/w")],
      projectScope: () => [Uri.file("/w")],
      transcriptsScope: () => [Uri.parse("s3://team/transcripts")],
      modelEndpoints: () => ["https://model.example/v1"],
    } as unknown as ScoutViewServer;
    const panel = new ScanviewPanel(view.panel, {} as ExtensionContext, server);
    try {
      for (const [method, path] of [
        ["POST", "/api/v2/startscan"],
        ["PUT", "/api/v2/project/config"],
      ]) {
        for (const body of [
          "{",
          "[]",
          "null",
          '{"unknown": "x"}',
          ...[
            { transcripts: "file:///" },
            { scanners: { x: 42 } },
            { validation: { x: 42 } },
            { model_roles: { x: 42 } },
            { scans: "/outside/%2e%2e/w/scans" },
            {
              scanners: [
                { name: "scanner", file: "/outside/%2e%2e/w/scanner.py" },
              ],
            },
            { scans: "/outside" },
            { results: "/outside" },
            { scanners: [{ name: "scanner", file: "/outside/scanner.py" }] },
            {
              scanners: { scanner: { name: "scanner", file: "../outside.py" } },
            },
            { validation: { scanner: "/outside/cases.json" } },
            { model_args: "/outside/args.json" },
            { transcripts: { dir: "/w/logs" } },
            { model_base_url: "https://unapproved.example" },
            {
              model_roles: {
                grader: {
                  model: "provider/model",
                  base_url: "https://unapproved.example",
                },
              },
            },
          ].map((value) => JSON.stringify(value)),
        ]) {
          assert.ok(
            (await view.request("http_request", [{ method, path, body }]))
              .error,
            body
          );
          assert.strictEqual(calls, 0);
        }
      }
      for (const [method, path] of [
        ["POST", "/api/v2/startscan"],
        ["PUT", "/api/v2/project/config"],
      ]) {
        const body = JSON.stringify({
          transcripts: "s3://team/transcripts/run",
          scans: "./scans",
          model_base_url: "https://model.example/v1",
          scanners: [
            {
              name: "scanner",
              file: "scanner.py",
              params: { prompt: "Keep supported scanner parameters" },
            },
          ],
          validation: { scanner: "cases.json" },
          model_args: "args.json",
        });
        assert.ok(
          !(await view.request("http_request", [{ method, path, body }])).error
        );
      }
      assert.strictEqual(calls, 2);
      const nestedBody = JSON.stringify({
        results: "./scans",
        scanners: { scanner: { name: "scanner", file: "scanner.py" } },
        validation: { scanner: { cases: [] } },
        model_roles: {
          grader: "provider/model",
          critic: {
            model: "provider/model",
            base_url: "https://model.example/v1",
          },
        },
      });
      for (const [method, path] of [
        ["POST", "/api/v2/startscan"],
        ["PUT", "/api/v2/project/config"],
      ]) {
        assert.ok(
          !(
            await view.request("http_request", [
              { method, path, body: nestedBody },
            ])
          ).error
        );
      }
      assert.strictEqual(calls, 4);
    } finally {
      panel.dispose();
    }
  });
  test("every named log family rejects encoded escapes before calling the server", async () => {
    const view = webview();
    let calls = 0;
    const call = () => {
      calls++;
      return Promise.resolve("ok");
    };
    const server = Object.fromEntries(
      [
        "evalLog",
        "evalLogSize",
        "evalLogBytes",
        "evalLogHeaders",
        "evalLogPendingSamples",
        "evalLogSampleData",
        "logMessage",
        "editLog",
        "postSearch",
        "getSearchResult",
        "proxyRpcRequest",
      ].map((name) => [name, call])
    ) as unknown as InspectViewServer;
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      server,
      "dir",
      Uri.file("/w/logs")
    );
    try {
      for (const method of [
        "eval_log",
        "eval_log_size",
        "eval_log_bytes",
        "eval_log_headers",
        "eval_log_pending_samples",
        "eval_log_sample_data",
        "log_message",
        "edit_log",
        "post_search",
        "get_search_result",
      ]) {
        for (const location of [
          "/w/logs/..%2F..%2Foutside",
          "file:///w/logs/x%23/../../outside",
          "file:///w/logs/x%3F/../../outside",
          "/w/logs/%E0%A4%A",
        ]) {
          const response = await view.request(method, [
            method === "eval_log_headers" ? [location] : location,
            0,
            10,
          ]);
          assert.ok(response.error, `${method}: ${location}`);
          assert.strictEqual(calls, 0);
        }
      }
      for (const location of [
        "/w/logs/..%2F..%2Foutside",
        "file:///w/logs/x%23/../../outside",
      ]) {
        assert.ok(
          (
            await view.request("http_request", [
              { method: "GET", path: `/api/log-bytes/${enc(location)}` },
            ])
          ).error
        );
        assert.strictEqual(calls, 0);
      }
      assert.ok(
        !(
          await view.request("eval_log_bytes", ["/w/logs/my%20run.eval", 0, 10])
        ).error
      );
      assert.strictEqual(calls, 1);
    } finally {
      panel.dispose();
    }
  });

  test("a single scan cannot list siblings, read parent transcripts, mutate project, or delete", async () => {
    const view = webview();
    let calls = 0;
    const call = () => {
      calls++;
      return Promise.resolve("ok");
    };
    const server = {
      legacy: {
        getScans: call,
        getScan: call,
        getScannerDataframe: call,
        getScannerDataframeInput: call,
      },
      proxyRpcRequest: call,
      projectScope: () => [Uri.file("/w")],
      transcriptsScope: () => [Uri.file("/w")],
    } as unknown as ScoutViewServer;
    const panel = new ScanviewPanel(
      view.panel,
      {} as ExtensionContext,
      server,
      () => [Uri.file("/w/scans/scan_id=own")]
    );
    try {
      for (const method of [
        "get_scan",
        "get_scanner_dataframe",
        "get_scanner_dataframe_input",
      ]) {
        for (const location of [
          "/w/scans/scan_id=other",
          "/w/scans/scan_id=own/..%2F..%2Foutside",
          "file:///w/scans/scan_id=own/x%23/../../outside",
          "/outside/%2e%2e/w/scans/scan_id=own",
        ]) {
          assert.ok(
            (await view.request(method, [location, "scanner", "uuid"])).error
          );
          assert.strictEqual(calls, 0);
        }
      }
      assert.ok((await view.request("get_scans", [])).error);
      const parent = b64("/w/scans");
      for (const request of [
        {
          method: "GET",
          path: `/api/v2/scans/${b64("/outside/%2e%2e/w/scans/scan_id=own")}/${b64(".")}`,
          headers: { Accept: "application/zip" },
        },
        { method: "POST", path: `/api/v2/scans/${parent}` },
        {
          method: "GET",
          path: `/api/v2/scans/${parent}/${b64("scan_id=other")}`,
        },
        { method: "POST", path: `/api/v2/transcripts/${parent}` },
        { method: "POST", path: "/api/v2/startscan", body: "{}" },
        { method: "PUT", path: "/api/v2/project/config", body: "{}" },
        { method: "POST", path: "/api/v2/validations", body: "{}" },
        ...["DELETE", "delete", "Delete", "dElEtE"].map((method) => ({
          method,
          path: `/api/v2/scans/${parent}/${b64("scan_id=own")}`,
        })),
      ]) {
        assert.ok(
          (await view.request("http_request", [request])).error,
          JSON.stringify(request)
        );
        assert.strictEqual(calls, 0);
      }
      for (const route of [
        `/api/v2/scans/${parent}/${b64("scan_id=own")}`,
        `/api/scan/${enc("/w/scans/scan_id=own")}`,
      ]) {
        assert.ok(
          !(
            await view.request("http_request", [{ method: "GET", path: route }])
          ).error
        );
      }
      assert.strictEqual(calls, 2);
    } finally {
      panel.dispose();
    }
  });
});
