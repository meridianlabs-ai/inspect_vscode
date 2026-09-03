import * as assert from "assert";

import { Uri } from "vscode";

import { validateLogUri } from "../../providers/protocol-handler";

suite("Protocol Handler Test Suite", () => {
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
