import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Uri } from "vscode";

import { toAbsolutePath } from "../../core/path";
import { getWebviewPanelHtml } from "../../core/webview";
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
  };
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

    test("should NOT stamp a nonce on scripts injected via extraHead", () => {
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
        // Simulate a payload that broke out of an inline JSON block and injected
        // a live <script> element into the head fragment.
        const extraHead =
          '<script id="legit" type="application/json">{}</script>' +
          "<script>window.__pwned = true;</script>";
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0",
          null,
          extraHead
        );

        // The trusted template script must be nonced...
        assert.ok(
          /<script nonce="[^"]+" src=/.test(result),
          "Template script should receive a nonce"
        );
        // ...but the injected script from extraHead must NOT be nonced, so the
        // nonce-based CSP blocks it.
        assert.ok(
          result.includes("<script>window.__pwned = true;</script>"),
          "Injected script should be present verbatim"
        );
        assert.ok(
          !/<script nonce="[^"]+">window\.__pwned/.test(result),
          "Injected script must NOT receive a nonce"
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
    test("should return 'not available' message when viewDir is null", () => {
      const result = getWebviewPanelHtml(null, mockPanel, "1.0.0");

      assert.ok(
        result.includes("view is not available"),
        "Should show not available message"
      );
    });
  });

  suite("Content-Security-Policy", () => {
    const cspSource = "https://mock.vscode-resource.test";
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<script>window.theme = 1;</script>
<script type="module" src="assets/index.js"></script>
</head>
<body><div id="app"></div></body>
</html>`;

    // The policy the inspect viewer ships, with shortened hashes.
    const viewerPolicy = {
      version: 1,
      directives: {
        "default-src": ["'none'"],
        "script-src": ["'self'", "'sha256-AAAA'", "'wasm-unsafe-eval'"],
        "worker-src": ["'self'"],
        "style-src-elem": ["'self'"],
        "style-src-attr": ["'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "media-src": ["data:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "frame-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    };

    /** Render a dist with `policyFile` (written verbatim when a string) and
     *  return the page's CSP meta content and script nonce. */
    function render(policyFile?: unknown): { csp: string; nonce: string } {
      const { viewDir, cleanup } = createTempViewDir(indexHtml);
      try {
        if (policyFile !== undefined) {
          fs.writeFileSync(
            path.join(viewDir, "content-security-policy.json"),
            typeof policyFile === "string"
              ? policyFile
              : JSON.stringify(policyFile),
            "utf-8"
          );
        }
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );
        const csp =
          /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(
            result
          )?.[1];
        const nonce = /<script nonce="([^"]+)"/.exec(result)?.[1];
        assert.ok(csp !== undefined, "Should inject a CSP meta");
        assert.ok(nonce !== undefined, "Should nonce the template scripts");
        return { csp, nonce };
      } finally {
        cleanup();
      }
    }

    const legacy = (nonce: string) =>
      `default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; worker-src 'self' ${cspSource} blob:; script-src 'nonce-${nonce}' 'unsafe-eval'; script-src-elem 'nonce-${nonce}' ${cspSource}; connect-src ${cspSource} blob:;`;

    test("translates the viewer's policy file for the webview", () => {
      const { csp, nonce } = render(viewerPolicy);
      assert.strictEqual(
        csp,
        [
          "default-src 'none'",
          `script-src 'self' 'sha256-AAAA' 'wasm-unsafe-eval' ${cspSource} 'nonce-${nonce}'`,
          `worker-src 'self' ${cspSource} blob:`,
          `style-src-elem 'self' ${cspSource}`,
          "style-src-attr 'unsafe-inline'",
          `img-src 'self' data: ${cspSource}`,
          "media-src data:",
          `font-src 'self' ${cspSource}`,
          `connect-src 'self' ${cspSource}`,
          "object-src 'none'",
          "frame-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join("; ")
      );
    });

    test("keeps the legacy policy for a dist without a policy file", () => {
      const { csp, nonce } = render();
      assert.strictEqual(csp, legacy(nonce));
    });

    for (const [name, file] of [
      ["invalid JSON", "{"],
      ["an unknown version", { ...viewerPolicy, version: 2 }],
      [
        "a non-array source list",
        { version: 1, directives: { "img-src": "x" } },
      ],
    ] as const) {
      test(`falls back to the legacy policy for ${name}`, () => {
        const { csp, nonce } = render(file);
        assert.strictEqual(csp, legacy(nonce));
      });
    }

    test("escapes the policy for the meta attribute", () => {
      const { csp } = render({
        version: 1,
        directives: { "img-src": ['"><script>x</script>$&'] },
      });
      assert.strictEqual(
        csp,
        // `$&` survives: not expanded as a replacement pattern.
        "img-src &quot;&gt;&lt;script&gt;x&lt;/script&gt;$&amp;"
      );
    });
  });
});
