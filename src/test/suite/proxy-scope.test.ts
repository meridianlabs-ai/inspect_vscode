/**
 * Tests for proxy-scope.ts — confinement of the generic http_request proxy.
 */
import * as assert from "assert";

import { Uri } from "vscode";

import { locationInScope } from "../../core/package/location-scope";
import {
  assertLogProxyInScope,
  assertScanProxyInScope,
} from "../../core/package/proxy-scope";
import type { HttpProxyRpcRequest } from "../../core/package/view-server";
import { logPathInScopeAllowingEncoded } from "../../providers/logview/logview-panel";
import { scanLocationInScopeAllowingEncoded } from "../../providers/scanview/scanview-panel";

const enc = encodeURIComponent;
const b64url = (v: string) => Buffer.from(v, "utf-8").toString("base64url");

// Use the panels' real scope predicates (which normalize ".." traversal) so the
// tests exercise the same checks the proxy is wired to in production.
const logDir = Uri.parse("file:///w/logs");
const inScope = (loc: string) =>
  logPathInScopeAllowingEncoded("dir", logDir, loc);
const directoryInScope = (loc: string) => locationInScope([logDir], loc);

type Method = HttpProxyRpcRequest["method"];
const req = (path: string, method: Method = "GET") => ({ method, path });

suite("Proxy Scope Test Suite", () => {
  suite("assertLogProxyInScope", () => {
    const ok = (path: string, method?: Method) =>
      assert.doesNotThrow(() =>
        assertLogProxyInScope(req(path, method), inScope, directoryInScope)
      );
    const rejects = (path: string, method?: Method) =>
      assert.throws(() =>
        assertLogProxyInScope(req(path, method), inScope, directoryInScope)
      );

    test("allows no-location endpoints", () => {
      ok(`/api/log-dir?log_dir=${enc("file:///w/logs")}`);
      ok("/api/user-info");
      ok("/api/app-config");
      ok("/api/dist");
      ok("/api/scout/searches?type=events&count=10");
    });

    test("rejects shared defaults unless the panel has bound an explicit location", () => {
      for (const path of [
        "/api/log-dir",
        "/api/logs",
        "/api/log-files",
        "/api/eval-set",
        "/api/flow",
      ])
        rejects(path);
      ok("/api/log-headers");
      ok("/api/events?last_eval_time=123");
    });

    test("allows in-scope file/dir locations", () => {
      ok(`/api/logs/${enc("file:///w/logs/run.eval")}?header-only=false`);
      ok(`/api/log-info/${enc("file:///w/logs/run.eval")}`);
      ok(`/api/log-download/${enc("file:///w/logs/run.eval")}`);
      ok(`/api/log-bytes/${enc("file:///w/logs/run.eval")}?start=0&end=9`);
      ok(`/api/log-edit/${enc("file:///w/logs/run.eval")}`, "POST");
      ok(`/api/logs?log_dir=${enc("file:///w/logs")}`);
      ok(`/api/pending-samples?log=${enc("file:///w/logs/run.eval")}`);
      ok(
        `/api/pending-sample-data-urls?log=${enc(
          "file:///w/logs/run.eval"
        )}&id=1&epoch=1`
      );
      ok(
        `/api/log-message?log_file=${enc("file:///w/logs/run.eval")}&message=x`,
        "POST"
      );
      ok(`/api/eval-set?log_dir=${enc("file:///w/logs")}&dir=set-a`);
      ok(
        `/api/log-headers?file=${enc("file:///w/logs/a.eval")}&file=${enc(
          "file:///w/logs/b.eval"
        )}`
      );
      ok(
        `/api/scout/transcripts/${b64url("file:///w/logs")}/tid/search`,
        "POST"
      );
      // bare (non-URI) paths resolve like file URIs
      ok(`/api/log-bytes/${enc("/w/logs/run.eval")}`);
    });

    test("rejects out-of-scope locations on every route", () => {
      rejects(`/api/logs/${enc("file:///etc/passwd")}`);
      rejects(`/api/log-info/${enc("file:///etc/passwd")}`);
      rejects(`/api/log-download/${enc("file:///etc/passwd")}`);
      rejects(`/api/log-bytes/${enc("file:///home/v/.ssh/id_rsa")}`);
      rejects(`/api/log-edit/${enc("file:///etc/cron.d/x")}`, "POST");
      rejects(`/api/eval-set?log_dir=${enc("file:///w/logs")}&dir=../../etc`);
      ok(`/api/eval-set?log_dir=${enc("file:///w/logs")}&dir=/etc`);
      rejects(`/api/logs?log_dir=${enc("file:///")}`);
      rejects(`/api/pending-samples?log=${enc("file:///etc/passwd")}`);
      // one in-scope and one out-of-scope file → rejected
      rejects(
        `/api/log-headers?file=${enc("file:///w/logs/a.eval")}&file=${enc(
          "file:///etc/passwd"
        )}`
      );
      rejects(
        `/api/scout/transcripts/${b64url("file:///other")}/tid/search`,
        "POST"
      );
    });

    test("flow and eval-set check Inspect concatenation, including repeated and empty parameters", () => {
      for (const route of ["flow", "eval-set"]) {
        const url = (base: string, sub: string) =>
          `/api/${route}?log_dir=${enc(base)}&dir=${enc(sub)}`;
        rejects(url("/outside", "/w/logs"));
        rejects(url("/outside", "///w/logs"));
        rejects(url("", "/w/logs"));
        rejects(url("/outside", ""));
        rejects(url("/w/logs", "../../outside"));
        rejects(`${url("/w/logs", "set")}&log_dir=${enc("/outside")}`);
        rejects(`${url("/w/logs", "set")}&dir=${enc("../../outside")}`);
        ok(url("/w/logs", "set"));
        ok(url("/w/logs", "/set"));
        ok(url("/w/logs", ""));
        ok(url("/w", "logs/set"));
      }
    });

    test("checks the whole {log:path} remainder, not just its first segment", () => {
      // The server route is a catch-all: an in-scope first segment followed by
      // further (traversing) segments resolves outside the scope.
      rejects(`/api/log-bytes/${enc("file:///w/logs")}/..%2F..%2Fetc%2Fpasswd`);
      rejects(`/api/logs/${enc("file:///w/logs")}/${enc("../../etc/passwd")}`);
      rejects(`/api/log-edit/${enc("file:///w/logs")}/../../etc/x`, "POST");
      // ...while a genuinely in-scope multi-segment remainder is fine
      ok(`/api/log-bytes/${enc("file:///w/logs")}/run.eval`);
      // and an empty remainder is not a location
      rejects("/api/log-bytes/");
    });

    test("rejects double-encoded traversal in bare paths (server decodes twice)", () => {
      // "/w/logs/..%2F..%2Fetc%2Fpasswd" is a literal odd file name to a naive
      // check, but the server unquotes it to "/w/logs/../../etc/passwd".
      rejects(`/api/log-bytes/${enc("/w/logs/..%2F..%2Fetc%2Fpasswd")}`);
      rejects(
        `/api/pending-samples?log=${enc("/w/logs/..%2F..%2Fetc%2Fpasswd")}`
      );
      // malformed escapes are rejected rather than passed through
      rejects(`/api/log-bytes/${enc("/w/logs/%E0%A4%A")}`);
    });

    test("checks every occurrence of a query location (FastAPI takes the last)", () => {
      const inDir = enc("file:///w/logs");
      const outDir = enc("file:///etc");
      rejects(`/api/logs?log_dir=${inDir}&log_dir=${outDir}`);
      rejects(`/api/log-files?log_dir=${outDir}&log_dir=${inDir}`);
      rejects(
        `/api/pending-samples?log=${enc("file:///w/logs/a.eval")}&log=${enc(
          "file:///etc/passwd"
        )}`
      );
      rejects(
        `/api/log-message?log_file=${enc("file:///w/logs/a.eval")}&log_file=${enc(
          "file:///etc/x"
        )}&message=m`,
        "POST"
      );
      rejects(`/api/eval-set?log_dir=${inDir}&log_dir=${outDir}&dir=sub`);
      rejects(`/api/eval-set?log_dir=${inDir}&dir=sub&dir=../../etc`);
      // repeats that are all in scope are fine
      ok(`/api/logs?log_dir=${inDir}&log_dir=${inDir}`);
    });

    test("rejects an empty query location (the server does not treat it as the default)", () => {
      rejects("/api/logs?log_dir=");
      rejects("/api/log-files?log_dir=");
      rejects("/api/pending-samples?log=");
      rejects("/api/log-headers?file=");
    });

    test("rejects non-canonical base64url segments", () => {
      const dir = b64url("file:///w/logs");
      // a lenient decoder would drop the stray character and see the in-scope dir
      rejects(`/api/scout/transcripts/${dir}!/tid/search`, "POST");
      rejects(`/api/scout/transcripts/${dir}%20/tid/search`, "POST");
      // optional padding on canonical input is accepted
      ok(
        `/api/scout/transcripts/${dir}${"=".repeat((4 - (dir.length % 4)) % 4)}/tid/search`,
        "POST"
      );
    });

    test("rejects DELETE and the log-delete route", () => {
      rejects(`/api/log-delete/${enc("file:///w/logs/run.eval")}`, "DELETE");
      rejects(`/api/log-delete/${enc("file:///w/logs/run.eval")}`);
      rejects(`/api/logs/${enc("file:///w/logs/run.eval")}`, "DELETE");
      rejects("/api/log-dir", "DELETE");
    });

    test("rejects unknown routes by default", () => {
      rejects("/api/terminal");
      rejects("/api/../secret");
      rejects("/not-api/logs");
      rejects("//evil.example/api/log-dir");
    });
  });

  suite("assertScanProxyInScope", () => {
    const scanDir = Uri.parse("file:///w/scans");
    const transcriptsDir = Uri.parse("s3://bucket/logs");
    const scanInScope = (loc: string) =>
      scanLocationInScopeAllowingEncoded([scanDir], loc);
    const transcriptsInScope = (loc: string) =>
      scanLocationInScopeAllowingEncoded([scanDir, transcriptsDir], loc);
    const ok = (path: string, method?: Method) =>
      assert.doesNotThrow(() =>
        assertScanProxyInScope(
          req(path, method),
          scanInScope,
          transcriptsInScope,
          { fullView: true }
        )
      );
    const rejects = (path: string, method?: Method) =>
      assert.throws(() =>
        assertScanProxyInScope(
          req(path, method),
          scanInScope,
          transcriptsInScope,
          { fullView: true }
        )
      );

    test("allows no-location and default listing endpoints", () => {
      ok("/api/v2/dist");
      ok("/api/scans");
      ok("/api/v2/app-config");
      ok("/api/v2/project/config");
      rejects("/api/v2/project/config", "PUT");
      ok("/api/v2/scanners");
      ok("/api/v2/searches");
      ok("/api/v2/scans/active");
      ok("/api/v2/topics/stream");
      rejects("/api/v2/startscan", "POST");
      ok("/api/v2/validations");
    });

    test("allows in-scope scan locations", () => {
      ok(`/api/scan/${enc("file:///w/scans/scan_id=x")}?status_only=true`);
      ok(`/api/scanner_df/${enc("file:///w/scans/scan_id=x")}?scanner=s`);
      // v2 {dir}/{scan} segments are base64url-encoded.
      ok(`/api/v2/scans/${b64url("file:///w/scans")}`, "POST");
      ok(`/api/v2/scans/${b64url("file:///w/scans")}/distinct`, "POST");
      ok(`/api/v2/scans/${b64url("file:///w/scans")}/${b64url("scan_id=x")}`);
      ok(
        `/api/v2/scans/${b64url("file:///w/scans")}/${b64url(
          "scan_id=x"
        )}/scanner?limit=10`
      );
    });

    test("checks the joined {dir}/{scan} location like the server does", () => {
      const dir = b64url("file:///w/scans");
      // UPath(dir) / "<absolute>" replaces dir entirely
      rejects(`/api/v2/scans/${dir}/${b64url("/Users/me/Documents")}`);
      rejects(`/api/v2/scans/${dir}/${b64url("file:///etc")}`);
      rejects(`/api/v2/scans/${dir}/${b64url("s3://other/bucket")}`);
      // and a relative scan may not traverse out of dir
      rejects(`/api/v2/scans/${dir}/${b64url("../other/scan_id=x")}`);
      rejects(`/api/v2/scans/${dir}/${b64url("../../etc/passwd")}/scanner`);
    });

    test("checks the whole legacy {location:path} remainder", () => {
      rejects(`/api/scan/${enc("file:///w/scans")}/..%2F..%2Fetc`);
      rejects(`/api/scanner_df/${enc("file:///w/scans")}/../../etc?scanner=s`);
      rejects("/api/scan/");
    });

    test("rejects out-of-scope scan locations", () => {
      rejects(`/api/scan/${enc("file:///etc/passwd")}`);
      rejects(`/api/scan/${enc("file:///w/other/scan_id=x")}`);
      rejects(`/api/scans?results_dir=${enc("file:///")}`);
      rejects(`/api/v2/scans/${b64url("file:///elsewhere")}`, "POST");
      rejects(`/api/v2/scans/${b64url("file:///elsewhere")}/${b64url("s")}`);
    });

    test("scopes transcripts to the transcripts scope, not the scan scope", () => {
      const s3 = b64url("s3://bucket/logs");
      ok(`/api/v2/transcripts/${s3}`, "POST");
      ok(`/api/v2/transcripts/${s3}/tid/info`);
      ok(`/api/v2/transcripts/${s3}/tid/messages-events`);
      ok(`/api/v2/transcripts/${s3}/distinct`, "POST");
      ok(`/api/v2/transcripts/${s3}/tid/search`, "POST");
      // the scan dir itself is also admitted (the transcripts scope includes it)
      ok(`/api/v2/transcripts/${b64url("file:///w/scans")}/tid/info`);
      rejects(`/api/v2/transcripts/${b64url("file:///etc")}/tid/info`);
      rejects(`/api/v2/transcripts/${b64url("s3://other/logs")}/tid/info`);
      rejects("/api/v2/transcripts/");
    });

    test("checks every occurrence of results_dir", () => {
      rejects(
        `/api/scans?results_dir=${enc("file:///w/scans")}&results_dir=${enc(
          "file:///"
        )}`
      );
      rejects("/api/scans?results_dir=");
    });

    test("rejects non-canonical base64url segments", () => {
      const dir = b64url("file:///w/scans");
      rejects(`/api/v2/scans/${dir}!`, "POST");
      rejects(`/api/v2/scans/${dir}/${b64url("scan_id=x")}%2B`);
      rejects(`/api/v2/transcripts/${b64url("s3://bucket/logs")}~/tid/info`);
      // canonical with padding still fine
      ok(
        `/api/v2/scans/${dir}${"=".repeat((4 - (dir.length % 4)) % 4)}`,
        "POST"
      );
    });

    test("leaves validations to the server's project containment", () => {
      const v = b64url("file:///proj/validations/x.csv");
      ok(`/api/v2/validations/${v}`);
      ok(`/api/v2/validations/${v}`, "DELETE");
      ok(`/api/v2/validations/${v}/rename`, "PUT");
      ok(`/api/v2/validations/${v}/${b64url("case-1")}`, "DELETE");
    });

    test("rejects DELETE everywhere else", () => {
      rejects(
        `/api/v2/scans/${b64url("file:///w/scans")}/${b64url("scan_id=x")}`,
        "DELETE"
      );
      rejects(`/api/scan-delete/${enc("file:///w/scans/scan_id=x")}`, "DELETE");
      rejects(`/api/scan-delete/${enc("file:///w/scans/scan_id=x")}`);
      rejects("/api/v2/project/config", "DELETE");
    });

    test("rejects unknown routes by default", () => {
      rejects("/api/logs/whatever");
      rejects("/api/evil");
      rejects("/api/v2/evil");
    });
  });
});
