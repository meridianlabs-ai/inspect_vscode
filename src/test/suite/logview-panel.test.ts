import * as assert from "assert";

import { ExtensionContext, Uri } from "vscode";

import {
  kMethodEditLog,
  kMethodEvalLog,
  kMethodEvalLogBytes,
  kMethodEvalLogHeaders,
  kMethodEvalLogSize,
  kMethodGetSearchResult,
  kMethodHttpRequest,
  kMethodLogMessage,
  kMethodPendingSamples,
  kMethodPostSearch,
  kMethodSampleData,
} from "../../core/jsonrpc";
import { HostWebviewPanel } from "../../hooks";
import { InspectViewServer } from "../../providers/inspect/inspect-view-server";
import {
  jsonForScript,
  logPathInScope,
  logPathInScopeAllowingEncoded,
  LogviewPanel,
} from "../../providers/logview/logview-panel";

suite("logview-panel Test Suite", () => {
  suite("logPathInScope", () => {
    test("file panel allows only its own log file", () => {
      const uri = Uri.file("/w/logs/run.eval");
      assert.strictEqual(logPathInScope("file", uri, uri.toString()), true);
      assert.strictEqual(
        logPathInScope("file", uri, Uri.file("/w/logs/other.eval").toString()),
        false
      );
      assert.strictEqual(logPathInScope("file", uri, "/etc/passwd"), false);
    });

    test("dir panel allows descendants but not outside paths", () => {
      const dir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScope("dir", dir, Uri.file("/w/logs/run.eval").toString()),
        true
      );
      assert.strictEqual(
        logPathInScope("dir", dir, Uri.file("/etc/passwd").toString()),
        false
      );
    });

    test("dir panel rejects '..' traversal and sibling-prefix escapes", () => {
      const dir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScope(
          "dir",
          dir,
          Uri.file("/w/logs/../../home/victim/.aws/credentials").toString()
        ),
        false
      );
      assert.strictEqual(
        logPathInScope("dir", dir, Uri.file("/w/logs-evil/x.eval").toString()),
        false
      );
    });

    test("dir panel confines S3 scope to the same bucket/prefix", () => {
      const dir = Uri.parse("s3://team-a/logs");
      assert.strictEqual(
        logPathInScope("dir", dir, "s3://team-a/logs/run.eval"),
        true
      );
      assert.strictEqual(
        logPathInScope("dir", dir, "s3://team-b/logs/run.eval"),
        false
      );
    });

    test("rejects unparseable targets", () => {
      const uri = Uri.file("/w/logs/run.eval");
      assert.strictEqual(logPathInScope("file", uri, ""), false);
    });
  });

  suite("logPathInScopeAllowingEncoded", () => {
    test("accepts a scheme-stripped, percent-encoded in-scope path", () => {
      // The viewer passes transcriptDir = stripFileScheme(logFile), which keeps
      // percent-encoding (e.g. a space -> %20). The plain scope check would
      // reject it; the encoding-tolerant one must accept it.
      const uri = Uri.file("/w/my run/logs/run.eval");
      const transcriptDir = uri.toString().replace(/^file:\/\//, ""); // "/w/my%20run/logs/run.eval"
      assert.strictEqual(logPathInScope("file", uri, transcriptDir), false);
      assert.strictEqual(
        logPathInScopeAllowingEncoded("file", uri, transcriptDir),
        true
      );
    });

    test("still rejects an out-of-scope encoded path (incl. traversal)", () => {
      const dir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/etc/passwd"),
        false
      );
      // %2e%2e -> .. must still be caught after decoding.
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "/w/logs/%2e%2e/%2e%2e/etc/passwd"
        ),
        false
      );
    });

    test("rejects percent-encoded traversal in a bare path that the plain check misses", () => {
      // The server unquotes the location once more, so "/w/logs/..%2F..%2F..."
      // is "/w/logs/../../..." to it. Uri.file keeps %2F literal, so the plain
      // check sees one odd descendant name and accepts; the decoded check must
      // not.
      const dir = Uri.file("/w/logs");
      const traversal = "/w/logs/..%2F..%2Fetc%2Fpasswd";
      assert.strictEqual(logPathInScope("dir", dir, traversal), true);
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, traversal),
        false
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "/w/logs/%2e%2e%2f%2e%2e%2fhome%2fvictim%2f.ssh%2fid_rsa"
        ),
        false
      );
      // the same escape inside a file:// URI
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/logs/..%252F..%252Fetc%252Fpasswd"
        ),
        false
      );
      // a file panel never accepts anything but its own file
      const file = Uri.file("/w/logs/run.eval");
      assert.strictEqual(
        logPathInScopeAllowingEncoded("file", file, traversal),
        false
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "file",
          file,
          "/w/logs/run.eval%2F..%2Fother.eval"
        ),
        false
      );
    });

    test("accepts legitimate paths with spaces and percent characters", () => {
      const dir = Uri.file("/w/my run/logs");
      // bare, percent-encoded (transcriptDir form)
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/my%20run/logs/run.eval"),
        true
      );
      // file:// URI as vscode encodes it
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          Uri.file("/w/my run/logs/run.eval").toString()
        ),
        true
      );
      // file:// URI as the server's listing names it (unencoded space)
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/my run/logs/run.eval"
        ),
        true
      );
      // a literal '%' in a file name, encoded once
      const percentDir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          percentDir,
          "file:///w/logs/100%25done.eval"
        ),
        true
      );
      const percentFile = Uri.file("/w/logs/100%done.eval");
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "file",
          percentFile,
          percentFile.toString()
        ),
        true
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "file",
          percentFile,
          "/w/logs/100%25done.eval"
        ),
        true
      );
    });

    test("rejects malformed percent-encoding rather than guessing", () => {
      const dir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/logs/%E0%A4%A"),
        false
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/logs/%zz.eval"),
        false
      );
    });
  });

  suite("LogviewPanel RPC scope guard", () => {
    // Drive the real JSON-RPC handlers through a fake webview host and record
    // what reaches the (stubbed) view server, so the guard is exercised at the
    // method level rather than only as a predicate.
    type Call = { method: string; args: unknown[] };
    type Response = { result?: unknown; error?: { message: string } };

    const createPanel = (type: "file" | "dir", scope: Uri) => {
      const calls: Call[] = [];
      const recorder =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
          return Promise.resolve(`${method}-result`);
        };
      const server = {
        evalLog: recorder("evalLog"),
        evalLogSize: recorder("evalLogSize"),
        evalLogBytes: recorder("evalLogBytes"),
        evalLogHeaders: recorder("evalLogHeaders"),
        evalLogPendingSamples: recorder("evalLogPendingSamples"),
        evalLogSampleData: recorder("evalLogSampleData"),
        logMessage: recorder("logMessage"),
        editLog: recorder("editLog"),
        postSearch: recorder("postSearch"),
        getSearchResult: recorder("getSearchResult"),
        proxyRpcRequest: recorder("proxyRpcRequest"),
      };
      const receivers = new Set<(data: unknown) => void>();
      let posted: ((data: Response) => void) | undefined;
      const host = {
        webview: {
          onDidReceiveMessage: (handler: (data: unknown) => void) => {
            receivers.add(handler);
            return { dispose() {} };
          },
          postMessage: (data: Response) => {
            posted?.(data);
            return Promise.resolve(true);
          },
        },
      } as unknown as HostWebviewPanel;
      const panel = new LogviewPanel(
        host,
        {} as unknown as ExtensionContext,
        server as unknown as InspectViewServer,
        type,
        scope
      );
      let id = 0;
      const call = (method: string, params: unknown[]): Promise<Response> =>
        new Promise<Response>((resolve) => {
          posted = resolve;
          for (const receive of receivers) {
            receive({ jsonrpc: "2.0", id: ++id, method, params });
          }
        });
      return { panel, calls, call };
    };

    // Every path-bearing named method, with the location as its first param.
    const pathMethods = (target: string): Array<[string, unknown[]]> => [
      [kMethodEvalLog, [target, false]],
      [kMethodEvalLogSize, [target]],
      [kMethodEvalLogBytes, [target, 0, 10]],
      [kMethodEvalLogHeaders, [[target]]],
      [kMethodPendingSamples, [target, undefined]],
      [kMethodSampleData, [target, "s1", 1]],
      [kMethodLogMessage, [target, "hello"]],
      [kMethodEditLog, [target, {}, undefined]],
      [kMethodPostSearch, [target, "tid", {}]],
      [kMethodGetSearchResult, [target, "tid", "sid", undefined]],
    ];

    test("dir panel refuses percent-encoded traversal on every named method", async () => {
      const { panel, calls, call } = createPanel("dir", Uri.file("/w/logs"));
      try {
        for (const target of [
          "/w/logs/..%2F..%2Fetc%2Fpasswd",
          "/w/logs/%2e%2e/%2e%2e/home/victim/.ssh/id_rsa",
          "file:///w/logs/..%252F..%252Fetc%252Fpasswd",
          "/etc/passwd",
        ]) {
          for (const [method, params] of pathMethods(target)) {
            const response = await call(method, params);
            assert.ok(
              response.error,
              `${method} must refuse ${target}, got ${JSON.stringify(response)}`
            );
            assert.match(response.error.message, /outside the scope/);
          }
        }
        assert.deepStrictEqual(calls, [], "nothing may reach the server");
      } finally {
        panel.dispose();
      }
    });

    test("dir panel forwards in-scope locations verbatim, encoded or not", async () => {
      const { panel, calls, call } = createPanel(
        "dir",
        Uri.file("/w/my run/logs")
      );
      try {
        for (const target of [
          "file:///w/my%20run/logs/run.eval",
          "file:///w/my run/logs/run.eval",
          "/w/my%20run/logs/run.eval",
          "/w/my run/logs/sub/100%25done.eval",
        ]) {
          for (const [method, params] of pathMethods(target)) {
            const response = await call(method, params);
            assert.strictEqual(
              response.error,
              undefined,
              `${method} must accept ${target}, got ${JSON.stringify(response)}`
            );
            const last = calls[calls.length - 1]!;
            const forwarded =
              method === kMethodEvalLogHeaders
                ? (last.args[0] as string[])[0]
                : last.args[0];
            assert.strictEqual(forwarded, target, `${method} forwards raw`);
          }
        }
        assert.strictEqual(calls.length, 4 * pathMethods("").length);
      } finally {
        panel.dispose();
      }
    });

    test("file panel accepts only its own file", async () => {
      const file = Uri.file("/w/logs/run.eval");
      const { panel, calls, call } = createPanel("file", file);
      try {
        for (const target of [
          "/w/logs/other.eval",
          "/w/logs/run.eval%2F..%2Fother.eval",
          "/w/logs/..%2F..%2Fetc%2Fpasswd",
        ]) {
          for (const [method, params] of pathMethods(target)) {
            assert.ok(
              (await call(method, params)).error,
              `${method} ${target}`
            );
          }
        }
        assert.strictEqual(calls.length, 0);
        for (const target of [file.toString(), "/w/logs/run.eval"]) {
          const response = await call(kMethodEvalLogBytes, [target, 0, 1]);
          assert.strictEqual(response.error, undefined);
          assert.strictEqual(calls[calls.length - 1]!.args[0], target);
        }
      } finally {
        panel.dispose();
      }
    });

    test("http_request binds a bare listing to the panel's own location", async () => {
      const dir = Uri.file("/w/logs");
      const dirPanel = createPanel("dir", dir);
      const file = Uri.file("/w/logs/run.eval");
      const filePanel = createPanel("file", file);
      const proxied = (path: string) => ({ method: "GET", path });
      const forwardedPath = (calls: Call[]) => {
        const request = calls[calls.length - 1]!.args[0] as { path: string };
        return request.path;
      };
      const logDirOf = (path: string) =>
        new URL("http://127.0.0.1" + path).searchParams.getAll("log_dir");
      try {
        for (const route of ["/api/logs", "/api/log-files"]) {
          // dir panel: its own directory replaces the server default
          let response = await dirPanel.call(kMethodHttpRequest, [
            proxied(route),
          ]);
          assert.strictEqual(response.error, undefined, route);
          assert.deepStrictEqual(logDirOf(forwardedPath(dirPanel.calls)), [
            dir.toString(),
          ]);
          // file panel: only its own file may be listed
          response = await filePanel.call(kMethodHttpRequest, [proxied(route)]);
          assert.strictEqual(response.error, undefined, route);
          assert.deepStrictEqual(logDirOf(forwardedPath(filePanel.calls)), [
            file.toString(),
          ]);
        }
        // a supplied directory is judged, not replaced
        const other = `/api/logs?log_dir=${encodeURIComponent("file:///w/other")}`;
        assert.ok(
          (await dirPanel.call(kMethodHttpRequest, [proxied(other)])).error
        );
        assert.ok(
          (
            await filePanel.call(kMethodHttpRequest, [
              proxied(
                `/api/logs?log_dir=${encodeURIComponent(dir.toString())}`
              ),
            ])
          ).error,
          "a file panel may not list even its parent directory"
        );
        // and the encoded-traversal bypass is closed on the proxy as well
        assert.ok(
          (
            await dirPanel.call(kMethodHttpRequest, [
              proxied(
                `/api/log-bytes/${encodeURIComponent("/w/logs/..%2F..%2Fetc%2Fpasswd")}?start=0&end=9`
              ),
            ])
          ).error
        );
        assert.strictEqual(dirPanel.calls.length, 2);
        assert.strictEqual(filePanel.calls.length, 2);
      } finally {
        dirPanel.panel.dispose();
        filePanel.panel.dispose();
      }
    });
  });

  suite("jsonForScript", () => {
    test("round-trips ordinary values", () => {
      const value = { type: "updateState", sample_id: "task_42", epoch: 1 };
      assert.deepStrictEqual(JSON.parse(jsonForScript(value)), value);
    });

    test("escapes '<' so a </script> payload cannot break out (XSS)", () => {
      const payload = "</script><script>alert(1)</script>";
      const out = jsonForScript({ sample_id: payload });

      // The serialized output must contain no literal markup-significant
      // characters that could terminate the enclosing <script> element.
      assert.ok(!out.includes("<"), "must not contain a literal '<'");
      assert.ok(!out.includes(">"), "must not contain a literal '>'");
      assert.ok(out.includes("\\u003c"), "'<' should be encoded as \\u003c");

      // ...and it must still parse back to the original string, i.e. the
      // escaping only changed the byte representation, not the data.
      assert.strictEqual(
        (JSON.parse(out) as { sample_id: string }).sample_id,
        payload
      );
    });

    test("escapes ampersand and line/paragraph separators", () => {
      const out = jsonForScript({ v: "a&b\u2028c\u2029d" });
      assert.ok(!out.includes("&"), "must not contain a literal '&'");
      assert.ok(!out.includes("\u2028"), "must escape U+2028");
      assert.ok(!out.includes("\u2029"), "must escape U+2029");
      assert.strictEqual(
        (JSON.parse(out) as { v: string }).v,
        "a&b\u2028c\u2029d"
      );
    });
  });
});
