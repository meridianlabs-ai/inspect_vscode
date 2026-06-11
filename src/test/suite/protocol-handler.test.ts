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
  });
});
