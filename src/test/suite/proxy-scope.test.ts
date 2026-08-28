/**
 * Tests for proxy-scope.ts — confinement of the generic http_request proxy.
 */
import * as assert from "assert";

import {
  assertLogProxyInScope,
  assertScanProxyInScope,
} from "../../core/package/proxy-scope";

const enc = encodeURIComponent;
const b64url = (v: string) => Buffer.from(v, "utf-8").toString("base64url");
const b64 = (v: string) => Buffer.from(v, "utf-8").toString("base64");

// A scope that admits only locations under file:///w/logs (or the dir itself).
const IN = "file:///w/logs";
const inScope = (loc: string) =>
  loc === IN || loc.startsWith("file:///w/logs/");

const req = (path: string) => ({ method: "GET" as const, path });

suite("Proxy Scope Test Suite", () => {
  suite("assertLogProxyInScope", () => {
    const ok = (path: string) =>
      assert.doesNotThrow(() => assertLogProxyInScope(req(path), inScope));
    const rejects = (path: string) =>
      assert.throws(() => assertLogProxyInScope(req(path), inScope));

    test("allows no-location endpoints", () => {
      ok("/api/log-dir");
      ok("/api/user-info");
      ok("/api/app-config");
      ok("/api/dist");
      ok("/api/scout/searches?type=events&count=10");
    });

    test("allows in-scope file/dir locations", () => {
      ok(`/api/logs/${enc("file:///w/logs/run.eval")}?header-only=false`);
      ok(`/api/log-bytes/${enc("file:///w/logs/run.eval")}?start=0&end=9`);
      ok(`/api/log-edit/${enc("file:///w/logs/run.eval")}`);
      ok(`/api/logs?log_dir=${enc("file:///w/logs")}`);
      ok(`/api/pending-samples?log=${enc("file:///w/logs/run.eval")}`);
      ok(
        `/api/log-headers?file=${enc("file:///w/logs/a.eval")}&file=${enc(
          "file:///w/logs/b.eval"
        )}`
      );
      ok(`/api/scout/transcripts/${b64url("file:///w/logs")}/tid/search`);
    });

    test("rejects out-of-scope locations on every route", () => {
      rejects(`/api/logs/${enc("file:///etc/passwd")}`);
      rejects(`/api/log-bytes/${enc("file:///home/v/.ssh/id_rsa")}`);
      rejects(`/api/log-edit/${enc("file:///etc/cron.d/x")}`);
      rejects(`/api/logs?log_dir=${enc("file:///")}`);
      rejects(`/api/pending-samples?log=${enc("file:///etc/passwd")}`);
      // one in-scope and one out-of-scope file → rejected
      rejects(
        `/api/log-headers?file=${enc("file:///w/logs/a.eval")}&file=${enc(
          "file:///etc/passwd"
        )}`
      );
      rejects(`/api/scout/transcripts/${b64url("file:///other")}/tid/search`);
    });

    test("rejects unknown routes by default", () => {
      rejects("/api/terminal");
      rejects("/api/../secret");
      rejects("/not-api/logs");
    });
  });

  suite("assertScanProxyInScope", () => {
    const scanInScope = (loc: string) =>
      loc === "file:///w/scans" || loc.startsWith("file:///w/scans/");
    const ok = (path: string) =>
      assert.doesNotThrow(() => assertScanProxyInScope(req(path), scanInScope));
    const rejects = (path: string) =>
      assert.throws(() => assertScanProxyInScope(req(path), scanInScope));

    test("allows dist and default listing", () => {
      ok("/api/v2/dist");
      ok("/api/scans");
    });

    test("allows in-scope scan locations", () => {
      ok(`/api/scan/${enc("file:///w/scans/scan_id=x")}?status_only=true`);
      ok(`/api/scanner_df/${enc("file:///w/scans/scan_id=x")}?scanner=s`);
      ok(`/api/v2/scans/${enc(b64("file:///w/scans"))}`);
    });

    test("rejects out-of-scope scan locations", () => {
      rejects(`/api/scan/${enc("file:///etc/passwd")}`);
      rejects(`/api/scan-delete/${enc("file:///w/other/scan_id=x")}`);
      rejects(`/api/scans?results_dir=${enc("file:///")}`);
      rejects(`/api/v2/scans/${enc(b64("file:///elsewhere"))}`);
    });

    test("rejects unknown routes by default", () => {
      rejects("/api/logs/whatever");
      rejects("/api/evil");
    });
  });
});
