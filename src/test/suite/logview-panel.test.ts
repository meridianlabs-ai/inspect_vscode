import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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

    test("rejects an empty target without resolving it against the cwd", () => {
      const uri = Uri.file("/w/logs/run.eval");
      assert.strictEqual(logPathInScope("file", uri, ""), false);
      // a dir panel that contains the extension host's cwd must not accept ""
      const cwd = Uri.file(process.cwd());
      assert.strictEqual(logPathInScope("dir", cwd, ""), false);
      assert.strictEqual(logPathInScopeAllowingEncoded("dir", cwd, ""), false);
      const parent = Uri.file(path.dirname(process.cwd()));
      assert.strictEqual(logPathInScope("dir", parent, ""), false);
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", parent, ""),
        false
      );
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
          "file:///w/logs/..%2F..%2Fetc%2Fpasswd"
        ),
        false
      );
      // ...whereas encoding it twice names the file literally called
      // `..%2F..%2Fetc%2Fpasswd` inside the directory: the server decodes once
      // and opens the remaining `%2F` characters as part of the name.
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/logs/..%252F..%252Fetc%252Fpasswd"
        ),
        true
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

    test("keeps malformed escapes literal like the server, refuses invalid UTF-8", () => {
      const dir = Uri.file("/w/logs");
      // `urllib.parse.unquote` leaves an escape it cannot decode in place, so
      // `%zz.eval` is the file literally named that, inside the directory.
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/logs/%zz.eval"),
        true
      );
      // a valid escape run whose bytes are not UTF-8 would name a U+FFFD file
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/logs/%E0%A4%A"),
        false
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded("dir", dir, "/w/logs/%C3.eval"),
        false
      );
    });

    test("decodes exactly once: a literal-percent sibling is a different file", () => {
      // The server percent-decodes a location once (route decoding reverses
      // the transport's encodeURIComponent; normalize_uri/unquote does the
      // rest) and then opens the result literally. Anything still encoded in
      // that result is part of the file name, so `run%201.eval` is not the
      // panel's `run 1.eval`.
      const panel = Uri.file("/w/logs/run 1.eval");
      // the panel's own file, in every spelling the viewer produces
      for (const own of [
        panel.toString(), // file:///w/logs/run%201.eval (startup state)
        panel.toString(true), // file:///w/logs/run 1.eval (listing names)
        "/w/logs/run%201.eval", // scheme-stripped transcriptDir
        "/w/logs/run 1.eval",
      ]) {
        assert.strictEqual(
          logPathInScopeAllowingEncoded("file", panel, own),
          true,
          own
        );
      }
      // the sibling literally named `run%201.eval`, spelled so that one decode
      // yields its name
      for (const sibling of [
        "file:///w/logs/run%25201.eval",
        "/w/logs/run%25201.eval",
      ]) {
        assert.strictEqual(
          logPathInScopeAllowingEncoded("file", panel, sibling),
          false,
          sibling
        );
      }
      // the same requests judged by a directory panel: both files are inside
      const dir = Uri.file("/w/logs");
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/logs/run%25201.eval"
        ),
        true
      );
      // a literal `%2e%2e` directory name is not traversal (the server opens
      // the directory literally named that), while a decoded `..` still is
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/logs/%252e%252e/x.eval"
        ),
        true
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "dir",
          dir,
          "file:///w/logs/%2e%2e/x.eval"
        ),
        false
      );
    });

    test("accepts a literal-percent file name in its own correctly encoded spelling", () => {
      // A panel on the file literally named `literal%20.eval`: its encoded URI
      // is what the server resolves to that exact file, so it is accepted; the
      // once-encoded spelling would open `literal .eval` instead.
      const literal = Uri.file("/w/logs/literal%20.eval");
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "file",
          literal,
          "file:///w/logs/literal%2520.eval"
        ),
        true
      );
      assert.strictEqual(
        literal.toString(),
        "file:///w/logs/literal%2520.eval"
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded("file", literal, literal.toString()),
        true
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded(
          "file",
          literal,
          "file:///w/logs/literal%20.eval"
        ),
        false
      );
      // A panel on `100%done.eval`: the raw form from evalLogsSolo / server
      // listings has a malformed escape, which the server keeps literal.
      const percent = Uri.file("/w/logs/100%done.eval");
      assert.strictEqual(
        percent.toString(true),
        "file:///w/logs/100%done.eval"
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded("file", percent, percent.toString(true)),
        true
      );
      assert.strictEqual(
        logPathInScopeAllowingEncoded("file", percent, percent.toString()),
        true
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
          "file:///w/logs/..%2F..%2Fetc%2Fpasswd",
          "file:///w/logs/%2e%2e/%2e%2e/etc/passwd",
          "/etc/passwd",
          "",
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

    test("dir panel containing the cwd still refuses an empty location on every method", async () => {
      const { panel, calls, call } = createPanel(
        "dir",
        Uri.file(path.dirname(process.cwd()))
      );
      try {
        for (const [method, params] of pathMethods("")) {
          const response = await call(method, params);
          assert.ok(response.error, `${method} must refuse ""`);
          assert.match(response.error.message, /outside the scope/);
        }
        assert.deepStrictEqual(calls, []);
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

    test("file panel on a name with a space refuses its literal-percent sibling on every method", async () => {
      const file = Uri.file("/w/logs/run 1.eval");
      const { panel, calls, call } = createPanel("file", file);
      try {
        // `file:///w/logs/run%25201.eval` decodes once to the existing sibling
        // `run%201.eval`; nothing may reach the server for it.
        for (const target of [
          "file:///w/logs/run%25201.eval",
          "/w/logs/run%25201.eval",
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
        assert.deepStrictEqual(calls, []);
        // every spelling of the panel's own file is accepted and forwarded raw
        const own = [
          file.toString(),
          file.toString(true),
          "/w/logs/run%201.eval",
          "/w/logs/run 1.eval",
        ];
        for (const target of own) {
          for (const [method, params] of pathMethods(target)) {
            const response = await call(method, params);
            assert.strictEqual(
              response.error,
              undefined,
              `${method} must accept ${target}, got ${JSON.stringify(response)}`
            );
            const last: Call = calls[calls.length - 1]!;
            const forwarded: unknown =
              method === kMethodEvalLogHeaders
                ? (last.args[0] as string[])[0]
                : last.args[0];
            assert.strictEqual(forwarded, target, `${method} forwards raw`);
          }
        }
        assert.strictEqual(calls.length, own.length * pathMethods("").length);
      } finally {
        panel.dispose();
      }
    });

    test("file panel on a literal-percent name accepts its own encoded spellings", async () => {
      const literal = Uri.file("/w/logs/literal%20.eval");
      const literalPanel = createPanel("file", literal);
      const percent = Uri.file("/w/logs/100%done.eval");
      const percentPanel = createPanel("file", percent);
      try {
        let response = await literalPanel.call(kMethodEvalLogBytes, [
          literal.toString(),
          0,
          1,
        ]);
        assert.strictEqual(response.error, undefined);
        assert.strictEqual(
          literalPanel.calls[0]!.args[0],
          "file:///w/logs/literal%2520.eval"
        );
        // once-encoded, the server would open `literal .eval`
        response = await literalPanel.call(kMethodEvalLogBytes, [
          "file:///w/logs/literal%20.eval",
          0,
          1,
        ]);
        assert.ok(response.error);
        for (const target of [percent.toString(), percent.toString(true)]) {
          response = await percentPanel.call(kMethodEvalLogBytes, [
            target,
            0,
            1,
          ]);
          assert.strictEqual(response.error, undefined, target);
          assert.strictEqual(
            percentPanel.calls[percentPanel.calls.length - 1]!.args[0],
            target
          );
        }
        assert.strictEqual(literalPanel.calls.length, 1);
        assert.strictEqual(percentPanel.calls.length, 2);
      } finally {
        literalPanel.panel.dispose();
        percentPanel.panel.dispose();
      }
    });

    test("the accepted spellings open the panel's file, the refused one its sibling", () => {
      // Distinct fixture files, read the way the view server reads a named
      // location: the route decoding reverses the transport's encoding, then
      // one urllib-style unquote, then the local filesystem opens the result
      // literally (`file://` stripped, remaining `%` characters kept).
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "logview-scope-"));
      try {
        fs.writeFileSync(path.join(root, "run 1.eval"), "panel file");
        fs.writeFileSync(path.join(root, "run%201.eval"), "OTHER file");
        const unquoteOnce = (value: string) =>
          value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
        const serverReads = (raw: string) => {
          const location = unquoteOnce(raw);
          const file = location.startsWith("file://")
            ? location.slice("file://".length)
            : location;
          return fs.readFileSync(file, "utf8");
        };
        const panel = Uri.file(path.join(root, "run 1.eval"));
        const inScope = (raw: string) =>
          logPathInScopeAllowingEncoded("file", panel, raw);
        for (const own of [
          panel.toString(),
          panel.toString(true),
          panel.toString().replace(/^file:\/\//, ""),
          panel.fsPath,
        ]) {
          assert.strictEqual(inScope(own), true, own);
          assert.strictEqual(serverReads(own), "panel file", own);
        }
        const sibling = panel.toString().replace("%20", "%2520");
        assert.strictEqual(serverReads(sibling), "OTHER file");
        assert.strictEqual(inScope(sibling), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test("http_request judges proxied locations the same way", async () => {
      const dir = Uri.file("/w/logs");
      const dirPanel = createPanel("dir", dir);
      const file = Uri.file("/w/logs/run 1.eval");
      const filePanel = createPanel("file", file);
      const proxied = (path: string) => ({ method: "GET", path });
      try {
        // a bare listing is forwarded unchanged (the server lists its default)
        for (const route of ["/api/logs", "/api/log-files"]) {
          const response = await dirPanel.call(kMethodHttpRequest, [
            proxied(route),
          ]);
          assert.strictEqual(response.error, undefined, route);
          assert.deepStrictEqual(
            dirPanel.calls[dirPanel.calls.length - 1]!.args[0],
            proxied(route)
          );
        }
        // a supplied directory outside the panel is refused
        assert.ok(
          (
            await dirPanel.call(kMethodHttpRequest, [
              proxied(
                `/api/logs?log_dir=${encodeURIComponent("file:///w/other")}`
              ),
            ])
          ).error
        );
        // the encoded-traversal bypass is closed on the proxy as well
        assert.ok(
          (
            await dirPanel.call(kMethodHttpRequest, [
              proxied(
                `/api/log-bytes/${encodeURIComponent("/w/logs/..%2F..%2Fetc%2Fpasswd")}?start=0&end=9`
              ),
            ])
          ).error
        );
        // and so is the literal-percent sibling of a single-file panel
        assert.ok(
          (
            await filePanel.call(kMethodHttpRequest, [
              proxied(
                `/api/log-bytes/${encodeURIComponent("file:///w/logs/run%25201.eval")}?start=0&end=9`
              ),
            ])
          ).error
        );
        const ownBytes = `/api/log-bytes/${encodeURIComponent(file.toString())}?start=0&end=9`;
        const response = await filePanel.call(kMethodHttpRequest, [
          proxied(ownBytes),
        ]);
        assert.strictEqual(response.error, undefined);
        assert.deepStrictEqual(filePanel.calls[0]!.args[0], proxied(ownBytes));
        assert.strictEqual(dirPanel.calls.length, 2);
        assert.strictEqual(filePanel.calls.length, 1);
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
