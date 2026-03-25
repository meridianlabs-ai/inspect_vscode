import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Uri } from "vscode";

import { getWebviewPanelHtml } from "../../core/webview";
import { toAbsolutePath } from "../../core/path";
import { HostWebviewPanel } from "../../hooks";

/**
 * Create a minimal mock HostWebviewPanel for testing getWebviewPanelHtml.
 * Only the webview.cspSource and webview.asWebviewUri properties are used.
 */
function createMockPanel(): HostWebviewPanel {
  return {
    webview: {
      cspSource: "https://mock.vscode-resource.test",
      asWebviewUri: (uri: Uri) => uri,
      // Unused but required by Webview interface
      html: "",
      options: {},
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: () => Promise.resolve(true),
    },
    active: true,
    visible: true,
    viewColumn: 1,
    reveal: () => {},
    onDidChangeViewState: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {},
  } as unknown as HostWebviewPanel;
}

/**
 * Create a temporary directory with test fixture files.
 * Returns the path and a cleanup function.
 */
function createTempViewDir(indexContent: string): {
  viewDir: string;
  cleanup: () => void;
} {
  const viewDir = fs.mkdtempSync(path.join(os.tmpdir(), "webview-test-"));
  fs.writeFileSync(path.join(viewDir, "index.html"), indexContent, "utf-8");
  return {
    viewDir,
    cleanup: () => fs.rmSync(viewDir, { recursive: true, force: true }),
  };
}

suite("getWebviewPanelHtml Test Suite", () => {
  const mockPanel = createMockPanel();

  suite("Normal HTML rendering", () => {
    test("should return valid HTML for a bundled index.html", () => {
      const { viewDir, cleanup } = createTempViewDir(
        `<!DOCTYPE html>
<html lang="en">
<head>
<link rel="stylesheet" href="assets/index.css">
</head>
<body>
<div id="app"></div>
<script src="assets/index.js"></script>
</body>
</html>`
      );

      try {
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );

        assert.ok(result.includes("<html"), "Should contain <html tag");
        assert.ok(
          result.includes('class="vscode"'),
          "Should add vscode class to html tag"
        );
        assert.ok(
          result.includes("Content-Security-Policy"),
          "Should inject CSP meta tag"
        );
        assert.ok(
          result.includes('content="1.0.0"'),
          "Should inject extension version"
        );
        assert.ok(result.includes("nonce-"), "Should inject nonce");
      } finally {
        cleanup();
      }
    });

    test("should inject extraHead content", () => {
      const { viewDir, cleanup } = createTempViewDir(
        `<!DOCTYPE html>
<html lang="en">
<head>
</head>
<body></body>
</html>`
      );

      try {
        const extraHead =
          '<script id="test-state" type="application/json">{"test":true}</script>';
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0",
          null,
          extraHead
        );

        assert.ok(
          result.includes("test-state"),
          "Should include extraHead content"
        );
      } finally {
        cleanup();
      }
    });

    test("should rewrite script src attributes for bundled HTML", () => {
      const { viewDir, cleanup } = createTempViewDir(
        `<!DOCTYPE html>
<html lang="en">
<head>
</head>
<body>
<script src="assets/index.js"></script>
</body>
</html>`
      );

      try {
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );

        // The src should be rewritten to a webview URI (not the original relative path)
        assert.ok(
          !result.includes('src="assets/index.js"'),
          "Should rewrite script src"
        );
      } finally {
        cleanup();
      }
    });
  });

  suite("LFS pointer detection", () => {
    test("should return upgrade message for LFS pointer files", () => {
      const lfsContent = `version https://git-lfs.github.com/spec/v1
oid sha256:abc123def456
size 1217`;
      const { viewDir, cleanup } = createTempViewDir(lfsContent);

      try {
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0",
          null,
          "",
          "Inspect Scout"
        );

        assert.ok(
          result.includes("Please update to a newer version"),
          "Should show upgrade message"
        );
        assert.ok(
          result.includes("Inspect Scout"),
          "Should include package name in message"
        );
        assert.ok(
          !result.includes("git-lfs"),
          "Should not expose LFS pointer content"
        );
      } finally {
        cleanup();
      }
    });

    test("should use default package name when not specified", () => {
      const lfsContent = `version https://git-lfs.github.com/spec/v1
oid sha256:abc123def456
size 1217`;
      const { viewDir, cleanup } = createTempViewDir(lfsContent);

      try {
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );

        assert.ok(
          result.includes("the package"),
          "Should use default package name"
        );
      } finally {
        cleanup();
      }
    });
  });

  suite("Null viewDir handling", () => {
    test("should return 'Not available' when viewDir is null", () => {
      const result = getWebviewPanelHtml(null, mockPanel, "1.0.0");

      assert.ok(
        result.includes("Not available"),
        "Should show not available message"
      );
    });
  });
});
