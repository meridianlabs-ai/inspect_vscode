import * as assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ExtensionContext, Uri } from "vscode";

import { locationInScope } from "../../core/package/location-scope";
import { assertScanConfigInScope } from "../../core/package/scan-config-scope";
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
  test("relative local locations retain current-directory and dot-segment support", () => {
    const root = Uri.file(join(tmpdir(), "panel"));
    for (const location of [".", "./", "nested/..", "./inside.eval"])
      assert.ok(locationInScope([root], location, { base: root }), location);
    assert.ok(!locationInScope([root], "../outside", { base: root }));
  });
  test("POSIX backslash names cannot disguise an outside location", function () {
    if (process.platform === "win32") this.skip();
    const root = Uri.file("/review/panel");
    for (const location of [
      "/review/outside/..\\panel/run.eval",
      "../outside/..\\panel/run.eval",
    ]) {
      assert.ok(!locationInScope([root], location, { base: root }));
      assert.ok(
        !locationInScope([root], enc(location), { base: root, decode: true })
      );
      const inScope = (value: string) =>
        locationInScope([root], value, { base: root });
      assert.throws(() =>
        assertScanConfigInScope(JSON.stringify({ scans: location }), {
          scans: inScope,
          transcripts: inScope,
          project: inScope,
        })
      );
    }
    assert.ok(locationInScope([root], "inside\\name.eval", { base: root }));
  });

  test("log content and directory RPCs reject literal POSIX backslash escapes", async function () {
    if (process.platform === "win32") this.skip();
    const view = webview();
    let calls = 0;
    const call = () => {
      calls++;
      return Promise.resolve("ok");
    };
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      { evalLog: call, proxyRpcRequest: call } as unknown as InspectViewServer,
      "dir",
      Uri.file("/review/panel")
    );
    try {
      const outside = "/review/outside/..\\panel/run.eval";
      assert.ok((await view.request("eval_log", [outside])).error);
      for (const path of [
        `/api/log-bytes/${enc(outside)}`,
        `/api/logs?log_dir=${enc(outside)}`,
      ]) {
        assert.ok(
          (await view.request("http_request", [{ method: "GET", path }])).error
        );
      }
      assert.strictEqual(calls, 0);
    } finally {
      panel.dispose();
    }
  });

  test("named search forwards the exact decoded viewer location it authorizes", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "log-search-"));
    const location = join(workspace, "%2e%2e", "%2e%2e", "space %.eval");
    const seen: string[] = [];
    const search = (target: string) => {
      seen.push(target);
      return Promise.resolve("ok");
    };
    const view = webview();
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      {
        postSearch: search,
        getSearchResult: search,
      } as unknown as InspectViewServer,
      "file",
      Uri.file(location)
    );
    try {
      const viewerPath = Uri.file(location).toString().slice("file://".length);
      for (const method of ["post_search", "get_search_result"]) {
        assert.ok(!(await view.request(method, [viewerPath, "id", {}])).error);
        assert.strictEqual(seen.at(-1), Uri.file(location).path);
        assert.ok(
          (
            await view.request(method, [
              enc(join(workspace, "outside.eval")),
              "id",
              {},
            ])
          ).error
        );
      }
      assert.strictEqual(seen.length, 2);
    } finally {
      panel.dispose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
  test("named search cannot forward an outside literal path authorized by decoding", async () => {
    const view = webview();
    const seen: string[] = [];
    const search = (location: string) => {
      seen.push(location);
      return Promise.resolve("ok");
    };
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      {
        postSearch: search,
        getSearchResult: search,
      } as unknown as InspectViewServer,
      "dir",
      Uri.file("/review/panel")
    );
    try {
      for (const method of ["post_search", "get_search_result"]) {
        const supplied = "/review/outside/%2e%2e/panel/run.eval";
        assert.ok(!(await view.request(method, [supplied, "id", {}])).error);
        assert.strictEqual(seen.at(-1), "/review/outside/../panel/run.eval");
        assert.notStrictEqual(seen.at(-1), supplied);
        assert.ok(
          (await view.request(method, [enc(supplied), "id", {}])).error
        );
      }
      assert.strictEqual(seen.length, 2);
    } finally {
      panel.dispose();
    }
  });
  test("directory routes preserve literal percent paths after HTTP decoding", async () => {
    const view = webview();
    const seen: string[] = [];
    const server = {
      proxyRpcRequest: (request: { path: string }) => {
        seen.push(request.path);
        return Promise.resolve("ok");
      },
    } as unknown as InspectViewServer;
    const panel = new LogviewPanel(
      view.panel,
      {} as ExtensionContext,
      server,
      "dir",
      Uri.file("/panel")
    );
    try {
      const routes = ["log-dir", "logs", "log-files", "flow", "eval-set"];
      for (const route of routes) {
        const path = `/api/${route}?log_dir=${enc("/outside/%2e%2e/panel/nested")}&dir=set`;
        assert.ok(
          (await view.request("http_request", [{ method: "GET", path }])).error
        );
        assert.strictEqual(seen.length, 0);
      }
      for (const route of routes) {
        for (const directory of [
          "/panel/with spaces",
          "/panel/100%",
          "/panel/%2e%2e",
          "/panel/a?#b",
        ]) {
          const path = `/api/${route}?log_dir=${enc(directory)}&dir=set`;
          assert.ok(
            !(await view.request("http_request", [{ method: "GET", path }]))
              .error,
            path
          );
          assert.strictEqual(seen.at(-1), path);
        }
      }
      assert.strictEqual(seen.length, 20);
    } finally {
      panel.dispose();
    }
  });

  test("remote scope requires literal object-key identity as well as normalized containment", () => {
    const root = Uri.parse("s3://bucket/allowed");
    for (const location of [
      "s3://bucket/outside/../allowed/run",
      "s3://bucket/outside/./../allowed/run",
      "s3://bucket/outside\\..\\allowed/run",
      "s3://bucket//allowed/run",
      "s3://other/allowed/run",
      "s3://bucket/allowed/../../outside",
    ])
      assert.ok(!locationInScope([root], location), location);
    assert.ok(
      !locationInScope([root], "../allowed/run", {
        base: Uri.parse("s3://bucket/outside"),
      })
    );
    for (const location of [
      "run",
      "a/../run",
      "a/./run",
      "a//run",
      "a\\b",
      "100%",
      "with spaces",
    ]) {
      assert.ok(
        locationInScope([root], `s3://bucket/allowed/${location}`),
        location
      );
      assert.ok(locationInScope([root], location, { base: root }), location);
    }
    assert.ok(
      locationInScope(
        [Uri.parse("https://host/allowed")],
        "https://host/allowed/run"
      )
    );
    assert.ok(
      !locationInScope(
        [Uri.parse("https://host/allowed")],
        "https://host/allowed/../outside"
      )
    );
  });

  test("remote dot-key escapes are rejected by log, scan and transcript RPCs before forwarding", async () => {
    const logView = webview();
    const scanView = webview();
    let calls = 0;
    const call = () => {
      calls++;
      return Promise.resolve("ok");
    };
    const root = Uri.parse("s3://bucket/allowed");
    const logPanel = new LogviewPanel(
      logView.panel,
      {} as ExtensionContext,
      {
        proxyRpcRequest: call,
        evalLogBytes: call,
      } as unknown as InspectViewServer,
      "dir",
      root
    );
    const scanPanel = new ScanviewPanel(
      scanView.panel,
      {} as ExtensionContext,
      {
        legacy: { getScan: call },
        proxyRpcRequest: call,
        scanResultsScope: () => [root],
        transcriptsScope: () => [root],
        projectScope: () => [Uri.file("/w")],
        modelEndpoints: () => [],
      } as unknown as ScoutViewServer
    );
    try {
      const outside = "s3://bucket/outside/../allowed/run";
      assert.ok(
        (await logView.request("eval_log_bytes", [outside, 0, 10])).error
      );
      assert.ok((await scanView.request("get_scan", [outside])).error);
      for (const path of [
        `/api/flow?log_dir=${enc(outside)}`,
        `/api/log-bytes/${enc(outside)}`,
      ])
        assert.ok(
          (await logView.request("http_request", [{ method: "GET", path }]))
            .error
        );
      for (const path of [
        `/api/v2/scans/${b64(outside)}/${b64("run")}`,
        `/api/v2/transcripts/${b64(outside)}/id/info`,
      ])
        assert.ok(
          (await scanView.request("http_request", [{ method: "GET", path }]))
            .error
        );
      for (const [method, path] of [
        ["POST", "/api/v2/startscan"],
        ["PUT", "/api/v2/project/config"],
      ])
        assert.ok(
          (
            await scanView.request("http_request", [
              { method, path, body: JSON.stringify({ transcripts: outside }) },
            ])
          ).error
        );
      assert.strictEqual(calls, 0);
      for (const path of [
        `/api/v2/scans/${b64("s3://bucket/allowed")}/${b64("run")}`,
        `/api/v2/transcripts/${b64("s3://bucket/allowed")}/id/info`,
      ])
        assert.ok(
          !(await scanView.request("http_request", [{ method: "GET", path }]))
            .error
        );
      assert.strictEqual(calls, 2);
    } finally {
      logPanel.dispose();
      scanPanel.dispose();
    }
  });
  test("directory defaults are bound to the panel and file panels cannot use shared defaults", async () => {
    for (const type of ["file", "dir"] as const) {
      const workspace = mkdtempSync(join(tmpdir(), "log-default-"));
      const view = webview();
      const seen: string[] = [];
      const server = {
        proxyRpcRequest: (request: { path: string }) => {
          seen.push(request.path);
          return Promise.resolve("ok");
        },
      } as unknown as InspectViewServer;
      const root = Uri.file(
        join(workspace, type === "file" ? "run.eval" : "with spaces%")
      );
      const panel = new LogviewPanel(
        view.panel,
        {} as ExtensionContext,
        server,
        type,
        root
      );
      try {
        for (const route of ["flow", "eval-set"]) {
          const path = `/api/${route}?log_dir=${enc("/outside")}&dir=${enc("/panel")}`;
          assert.ok(
            (await view.request("http_request", [{ method: "GET", path }]))
              .error
          );
          assert.strictEqual(seen.length, 0);
        }
        for (const path of [
          "/api/flow",
          "/api/eval-set",
          "/api/logs",
          "/api/log-files",
          "/api/log-dir",
        ]) {
          const result = await view.request("http_request", [
            { method: "GET", path },
          ]);
          assert.strictEqual(Boolean(result.error), type === "file");
        }
        assert.strictEqual(seen.length, type === "file" ? 0 : 5);
        for (const path of seen)
          assert.strictEqual(
            new URL(`http://localhost${path}`).searchParams.get("log_dir"),
            root.fsPath
          );
      } finally {
        panel.dispose();
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  });
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
  test("project edits cannot broaden captured authority, including filesystem roots", () => {
    const config = { transcripts: "s3://team/logs", scans: "file:///w/scans" };
    const authority = captureProjectAuthority(config, (location) =>
      Uri.parse(location)
    );
    for (const transcripts of ["s3://team", "s3://team/"]) {
      const bucket = captureProjectAuthority({ transcripts }, (location) =>
        Uri.parse(location)
      );
      assert.ok(locationInScope(bucket.transcripts, "s3://team/run"));
      assert.ok(!locationInScope(bucket.transcripts, "s3://other/run"));
    }
    config.transcripts = "file:///";
    config.scans = "file:///";
    assert.ok(locationInScope(authority.transcripts, "s3://team/logs/run"));
    assert.ok(!locationInScope(authority.transcripts, "/outside"));
    assert.ok(!locationInScope(authority.scans, "/outside"));
    for (const transcripts of ["file:///", "file:///w/../", "file:///C:/"]) {
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
            { scans: "\\outside" },
            { scans: "\\\\server\\share\\outside" },
            { transcripts: "\\outside" },
            { model_args: "\\outside" },
            { validation: { x: { cases: [{ id: "one" }] } } },
            {
              validation: {
                x: { cases: [{ id: "one", target: true, labels: {} }] },
              },
            },
            { results: "/outside" },
            { scanners: [{ name: "scanner", file: "/outside/scanner.py" }] },
            {
              scanners: { scanner: { name: "scanner", file: "../outside.py" } },
            },
            { validation: { scanner: "/outside/cases.json" } },
            { model_args: "/outside/args.json" },
            ...["~", "~/args.json", "~other/args.json", "~\\args.json"].map(
              (model_args) => ({ model_args })
            ),
            { scans: "~/scans" },
            { validation: { scanner: "~/cases.json" } },
            ...[
              "./~/cases.csv",
              "././/~/cases.csv",
              ".\\~\\cases.csv",
              "./~other/cases.csv",
              "./~/cases.json",
            ].map((scanner) => ({ validation: { scanner } })),
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
      for (const model_args of [
        "./args.json",
        "/w/args.json",
        "./~/args.json",
        "args with spaces.json",
      ]) {
        for (const [method, path] of [
          ["POST", "/api/v2/startscan"],
          ["PUT", "/api/v2/project/config"],
        ]) {
          assert.ok(
            !(
              await view.request("http_request", [
                { method, path, body: JSON.stringify({ model_args }) },
              ])
            ).error
          );
        }
      }
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
      for (const scanner of [
        "cases.csv",
        "./cases.csv",
        "/w/cases.csv",
        "/w/~/cases.csv",
        "cases with spaces.csv",
      ]) {
        for (const [method, path] of [
          ["POST", "/api/v2/startscan"],
          ["PUT", "/api/v2/project/config"],
        ]) {
          assert.ok(
            !(
              await view.request("http_request", [
                {
                  method,
                  path,
                  body: JSON.stringify({ validation: { scanner } }),
                },
              ])
            ).error
          );
        }
      }
      assert.strictEqual(calls, 22);
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
      transcriptsScope: () => [Uri.parse("s3://team/transcripts")],
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
        { method: "GET", path: "/api/v2/validations" },
        {
          method: "GET",
          path: `/api/v2/validations/${b64("file:///w/other.json")}`,
        },
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
      for (const [method, suffix] of [
        ["HEAD", "info"],
        ["GET", "info"],
        ["GET", "messages-events"],
      ]) {
        assert.ok(
          !(
            await view.request("http_request", [
              {
                method,
                path: `/api/v2/transcripts/${b64("s3://team/transcripts")}/transcript-id/${suffix}`,
              },
            ])
          ).error
        );
      }
      assert.strictEqual(calls, 5);
    } finally {
      panel.dispose();
    }
  });
});
