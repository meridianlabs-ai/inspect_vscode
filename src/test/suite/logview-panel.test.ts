import * as assert from "assert";

import { Uri } from "vscode";

import {
  jsonForScript,
  logPathInScope,
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
