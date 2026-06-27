import * as assert from "assert";

import { Uri } from "vscode";

import { resolveLogDocumentLocation } from "../../providers/logview/logview-editor";

suite("Logview Editor Test Suite", () => {
  test("separates sample navigation state from a local resource URI", () => {
    const location = resolveLogDocumentLocation(
      Uri.file("/logs/run.eval").with({
        query: "sample_id=sample-1&epoch=2",
        fragment: "ignored",
      })
    );

    assert.strictEqual(location.resourceUri.query, "");
    assert.strictEqual(location.resourceUri.fragment, "");
    assert.strictEqual(location.sample_id, "sample-1");
    assert.strictEqual(location.epoch, "2");
  });

  test("preserves a signed URL query as resource identity", () => {
    const uri = Uri.parse(
      "https://example.test/run.eval?expires=60&signature=selected"
    );
    const location = resolveLogDocumentLocation(uri);

    assert.strictEqual(location.resourceUri.query, uri.query);
    assert.strictEqual(location.sample_id, undefined);
    assert.strictEqual(location.epoch, undefined);
  });

  test("does not rewrite mixed resource and navigation parameters", () => {
    const uri = Uri.parse(
      "https://example.test/run.eval?signature=selected&sample_id=sample-1&epoch=2"
    );
    const location = resolveLogDocumentLocation(uri);

    assert.strictEqual(location.resourceUri.query, uri.query);
    assert.strictEqual(location.sample_id, undefined);
    assert.strictEqual(location.epoch, undefined);
  });
});
