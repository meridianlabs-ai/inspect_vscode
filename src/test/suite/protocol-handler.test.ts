import * as assert from "assert";

import { Uri } from "vscode";

import {
  isTrustedLogLocation,
  validateLogUri,
} from "../../providers/protocol-handler";

suite("Protocol Handler Test Suite", () => {
  suite("isTrustedLogLocation", () => {
    test("accepts a remote log inside a configured remote log dir", () => {
      const roots = [Uri.parse("s3://bucket/logs")];
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://bucket/logs/run.eval"), roots),
        true
      );
      // Nested, and with a trailing slash on the root.
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://bucket/logs/2026/run.eval"), [
          Uri.parse("s3://bucket/logs/"),
        ]),
        true
      );
    });

    test("rejects a remote log outside every configured root", () => {
      const roots = [Uri.parse("s3://bucket/logs")];
      // Different bucket, same path shape.
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://evil/logs/run.eval"), roots),
        false
      );
      // Shared string prefix but a sibling directory.
      assert.strictEqual(
        isTrustedLogLocation(
          Uri.parse("s3://bucket/logs-evil/run.eval"),
          roots
        ),
        false
      );
      // Traversal back out of the root.
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://bucket/logs/../run.eval"), roots),
        false
      );
      // A local root never trusts a remote log, and no roots trusts nothing.
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://bucket/logs/run.eval"), [
          Uri.file("/w/logs"),
        ]),
        false
      );
      assert.strictEqual(
        isTrustedLogLocation(Uri.parse("s3://bucket/logs/run.eval"), []),
        false
      );
    });
  });

  suite("validateLogUri", () => {
    test("accepts a local .eval file", () => {
      assert.strictEqual(
        validateLogUri(Uri.parse("file:///logs/run.eval")),
        null
      );
    });

    test("accepts a local .json log", () => {
      assert.strictEqual(
        validateLogUri(Uri.parse("file:///logs/run.json")),
        null
      );
    });

    test("accepts remote s3 and https logs", () => {
      assert.strictEqual(
        validateLogUri(Uri.parse("s3://bucket/run.eval")),
        null
      );
      assert.strictEqual(
        validateLogUri(Uri.parse("https://example.com/run.json")),
        null
      );
    });

    test("ignores case in the extension", () => {
      assert.strictEqual(
        validateLogUri(Uri.parse("file:///logs/RUN.EVAL")),
        null
      );
    });

    test("rejects unsupported schemes", () => {
      const err = validateLogUri(Uri.parse("ssh://host/run.eval"));
      assert.ok(err && err.includes("unsupported location"));
    });

    test("rejects a command scheme (would-be code execution vector)", () => {
      const err = validateLogUri(
        Uri.parse("command:workbench.action.terminal.new")
      );
      assert.ok(err, "command: URIs must be rejected");
    });

    test("rejects files that are not recognized logs", () => {
      const err = validateLogUri(Uri.parse("file:///etc/passwd"));
      assert.ok(err && err.includes("not an Inspect log file"));
    });

    test("rejects a log-looking query that is not actually a log file", () => {
      const err = validateLogUri(Uri.parse("https://evil.example/page.html"));
      assert.ok(err && err.includes("not an Inspect log file"));
    });

    test("accepts a benign sample_id/epoch query", () => {
      assert.strictEqual(
        validateLogUri(
          Uri.parse("s3://bucket/run.eval?sample_id=task_42&epoch=1")
        ),
        null
      );
    });

    test("rejects a sample_id carrying HTML markup (XSS vector)", () => {
      const err = validateLogUri(
        Uri.parse(
          "s3://bucket/run.eval?sample_id=" +
            encodeURIComponent("</script><script>alert(1)</script>") +
            "&epoch=1"
        )
      );
      assert.ok(err && err.includes("invalid sample id"));
    });

    test("rejects a non-integer epoch", () => {
      const err = validateLogUri(
        Uri.parse("s3://bucket/run.eval?sample_id=ok&epoch=1e9")
      );
      assert.ok(err && err.includes("invalid epoch"));
    });

    test("rejects a file URI with a remote authority (NTLM leak vector)", () => {
      // file://host/share/x.eval → UNC on Windows; existsSync would trigger an
      // SMB/WebDAV NTLM handshake to the attacker host.
      const err = validateLogUri(
        Uri.parse("file://attacker.example/share/run.eval")
      );
      assert.ok(err && err.includes("host"));
    });

    test("accepts a hosted file URI inside a trusted root (UNC workspace)", () => {
      // A Windows workspace folder that is itself a UNC share: VS Code has
      // already connected to that host (gated by security.allowedUNCHosts), so
      // a log inside the folder reopens no credential-leak vector.
      const root = Uri.parse("file://server/share/proj");
      assert.strictEqual(
        validateLogUri(Uri.parse("file://server/share/proj/logs/run.eval"), {
          trustedRoots: [root],
        }),
        null
      );
    });

    test("rejects a hosted file URI outside every trusted root", () => {
      const root = Uri.parse("file://server/share/proj");
      // Same host, different share/folder.
      let err = validateLogUri(
        Uri.parse("file://server/share/other/run.eval"),
        {
          trustedRoots: [root],
        }
      );
      assert.ok(err && err.includes("host"));
      // Same path shape, different host.
      err = validateLogUri(
        Uri.parse("file://attacker.example/share/proj/logs/run.eval"),
        { trustedRoots: [root] }
      );
      assert.ok(err && err.includes("host"));
      // No roots at all: unchanged behaviour.
      err = validateLogUri(
        Uri.parse("file://server/share/proj/logs/run.eval"),
        { trustedRoots: [] }
      );
      assert.ok(err && err.includes("host"));
    });

    test("rejects a hosted file URI that traverses out of a trusted root", () => {
      const root = Uri.parse("file://server/share/proj");
      const err = validateLogUri(
        Uri.parse("file://server/share/proj/logs/../../other/run.eval"),
        { trustedRoots: [root] }
      );
      assert.ok(err && err.includes("host"));
    });

    test("rejects a remote authority carrying userinfo (host spoof)", () => {
      const err = validateLogUri(
        Uri.parse("https://logs.victim-corp.com@evil.example/run.eval")
      );
      assert.ok(err && err.includes("invalid host"));
    });

    test("still accepts a normal remote host and local file", () => {
      assert.strictEqual(
        validateLogUri(Uri.parse("s3://bucket/run.eval")),
        null
      );
      assert.strictEqual(
        validateLogUri(Uri.parse("file:///logs/run.eval")),
        null
      );
    });
  });
});
