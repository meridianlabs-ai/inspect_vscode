import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Uri } from "vscode";

import { toAbsolutePath } from "../../core/path";
import { getWebviewPanelHtml } from "../../core/webview";
import {
  buildWebviewCsp,
  kViewerCspFileName,
  loadViewerCsp,
  parseViewerCsp,
  stripCspMeta,
  ViewerCspError,
  ViewerCspFile,
  ViewerCspLoad,
} from "../../core/webview-csp";
import { legacyWebviewCsp, renderWebviewHtml } from "../../core/webview-render";
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
function createTempViewDir(
  indexContent: string,
  policyContent?: string
): {
  viewDir: string;
  cleanup: () => void;
} {
  const viewDir = fs.mkdtempSync(path.join(os.tmpdir(), "webview-test-"));
  fs.writeFileSync(path.join(viewDir, "index.html"), indexContent, "utf-8");
  if (policyContent !== undefined) {
    fs.writeFileSync(
      path.join(viewDir, kViewerCspFileName),
      policyContent,
      "utf-8"
    );
  }
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
    const kCspSource = "https://file+.vscode-resource.vscode-cdn.net";
    const kPolicy: ViewerCspFile = {
      version: 1,
      directives: {
        "default-src": ["'none'"],
        "script-src": [
          "'self'",
          "'sha256-dh/kDr+xuzejmjkOpzVExtX8ZIgsN1sFWP5R9yk1x24='",
          "'sha256-hTEVLGs7U/evjCQ3XH4NKheOkIqC/G7OvOjQBCIXFrw='",
          "'wasm-unsafe-eval'",
        ],
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
    const kExpectedCsp =
      "default-src 'none'; " +
      `script-src 'self' ${kCspSource} 'sha256-dh/kDr+xuzejmjkOpzVExtX8ZIgsN1sFWP5R9yk1x24=' 'sha256-hTEVLGs7U/evjCQ3XH4NKheOkIqC/G7OvOjQBCIXFrw=' 'wasm-unsafe-eval' 'nonce-NONCE'; ` +
      `worker-src 'self' ${kCspSource} blob:; ` +
      `style-src-elem 'self' ${kCspSource}; ` +
      "style-src-attr 'unsafe-inline'; " +
      `img-src 'self' ${kCspSource} data:; ` +
      "media-src data:; " +
      `font-src 'self' ${kCspSource}; ` +
      `connect-src 'self' ${kCspSource}; ` +
      "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

    const kBundledIndex = `<!DOCTYPE html>
<html lang="en">
<head>
<script>window.inline = true;</script>
<script type="module" src="./assets/index.js"></script>
<link rel="stylesheet" href="./assets/index.css">
</head>
<body style="min-width: 450px"></body>
</html>`;

    const cspMetas = (html: string): string[] =>
      [
        ...html.matchAll(
          /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g
        ),
      ].map((m) => m[1] ?? "");

    const nonceOf = (html: string): string => {
      const match = /<script nonce="([^"]+)"/.exec(html);
      assert.ok(match?.[1], "Expected a nonced script");
      return match[1];
    };

    test("builds the webview policy from the viewer's policy", () => {
      assert.strictEqual(
        buildWebviewCsp(kPolicy, kCspSource, "NONCE"),
        kExpectedCsp
      );
    });

    test("adds each cspSource token once, keeping viewer sources", () => {
      const csp = buildWebviewCsp(
        {
          version: 1,
          directives: {
            "default-src": ["'none'"],
            "script-src": ["'self'", "https://*.vscode-cdn.net"],
            "worker-src": ["'self'", "blob:"],
          },
        },
        "'self' https://*.vscode-cdn.net",
        "NONCE"
      );
      assert.strictEqual(
        csp,
        "default-src 'none'; script-src 'self' https://*.vscode-cdn.net 'nonce-NONCE'; worker-src 'self' https://*.vscode-cdn.net blob:"
      );
    });

    test("never widens the viewer's policy beyond the translation", () => {
      const csp = buildWebviewCsp(kPolicy, kCspSource, "NONCE");
      assert.ok(!csp.includes("'unsafe-eval'"));
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
      assert.ok(!/style-src-elem[^;]*'unsafe-inline'/.test(csp));
      assert.ok(!/(img|font|media)-src[^;]*blob:/.test(csp));
    });

    test("uses the legacy policy when the policy file is absent", () => {
      const { viewDir, cleanup } = createTempViewDir(kBundledIndex);
      try {
        assert.deepStrictEqual(loadViewerCsp(viewDir), { status: "absent" });
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );
        assert.deepStrictEqual(cspMetas(result), [
          legacyWebviewCsp(mockPanel.webview.cspSource, nonceOf(result)),
        ]);
      } finally {
        cleanup();
      }
    });

    test("keeps the legacy policy string unchanged", () => {
      assert.strictEqual(
        legacyWebviewCsp("SRC", "N"),
        "default-src 'none'; img-src SRC data:; font-src SRC data:; style-src SRC 'unsafe-inline'; worker-src 'self' SRC blob:; script-src 'nonce-N' 'unsafe-eval'; script-src-elem 'nonce-N' SRC; connect-src SRC blob:;"
      );
    });

    test("uses the translated policy when the policy file is present", () => {
      const { viewDir, cleanup } = createTempViewDir(
        kBundledIndex,
        JSON.stringify(kPolicy, null, 2)
      );
      try {
        const result = getWebviewPanelHtml(
          toAbsolutePath(viewDir),
          mockPanel,
          "1.0.0"
        );
        assert.deepStrictEqual(cspMetas(result), [
          buildWebviewCsp(
            kPolicy,
            mockPanel.webview.cspSource,
            nonceOf(result)
          ),
        ]);
      } finally {
        cleanup();
      }
    });

    test("stamps the policy's nonce on every template script", () => {
      const result = renderWebviewHtml({
        indexHtml: kBundledIndex,
        policy: { status: "valid", policy: kPolicy },
        cspSource: kCspSource,
        nonce: "NONCE",
        resourceUri: (p) => `${kCspSource}/dist/${p}`,
        extensionVersion: "1.0.0",
        extraHead: '<script id="state" type="application/json">{}</script>',
      });
      assert.deepStrictEqual(cspMetas(result), [kExpectedCsp]);
      assert.ok(
        result.includes('<script nonce="NONCE">window.inline = true;</script>')
      );
      assert.ok(
        result.includes(
          `<script nonce="NONCE" type="module" src="${kCspSource}/dist/./assets/index.js">`
        )
      );
      assert.ok(
        result.includes('<script id="state" type="application/json">'),
        "extraHead data blocks stay un-nonced"
      );
      assert.ok(result.includes('content="1.0.0"'));
    });

    test("strips a CSP meta tag shipped in the viewer's index.html", () => {
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<META HTTP-EQUIV=content-security-policy CONTENT="script-src 'self'" />
<meta http-equiv="Content-Security-Policy-Report-Only" content="default-src 'self'">
</head>
<body></body>
</html>`;
      const policies: ViewerCspLoad[] = [
        { status: "absent" },
        { status: "valid", policy: kPolicy },
      ];
      for (const policy of policies) {
        const result = renderWebviewHtml({
          indexHtml,
          policy,
          cspSource: kCspSource,
          nonce: "NONCE",
          resourceUri: (p) => p,
          extensionVersion: "1.0.0",
        });
        assert.strictEqual(
          (result.match(/content-security-policy"/gi) ?? []).length,
          1,
          "Only the extension's policy should remain"
        );
        assert.deepStrictEqual(cspMetas(result), [
          policy.status === "valid"
            ? kExpectedCsp
            : legacyWebviewCsp(kCspSource, "NONCE"),
        ]);
        assert.ok(result.includes("Content-Security-Policy-Report-Only"));
      }
    });

    test("refuses a policy-carrying index.html with no <head> start tag", () => {
      const result = renderWebviewHtml({
        indexHtml:
          '<!DOCTYPE html><html lang="en"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><script src="./a.js"></script></html>',
        policy: { status: "valid", policy: kPolicy },
        cspSource: kCspSource,
        nonce: "NONCE",
        resourceUri: (p) => p,
        extensionVersion: "1.0.0",
        packageName: "Inspect AI",
      });
      assert.ok(
        result.includes(
          "Inspect AI view could not be loaded because the insertion point for its Content-Security-Policy (the &lt;head&gt; start tag) was not found in its index.html."
        ),
        result
      );
      assert.ok(!result.includes("a.js"));
    });

    const headCases: [string, string][] = [
      [
        "CRLF line endings",
        '<!DOCTYPE html>\r\n<html lang="en">\r\n<head>\r\n<script src="./a.js"></script>\r\n</head>\r\n</html>',
      ],
      [
        "a <head> tag with attributes",
        '<!DOCTYPE html><html lang="en"><head data-x="1"><script src="./a.js"></script></head></html>',
      ],
    ];
    for (const [name, indexHtml] of headCases) {
      test(`inserts the policy into an index.html with ${name}`, () => {
        const result = renderWebviewHtml({
          indexHtml,
          policy: { status: "valid", policy: kPolicy },
          cspSource: kCspSource,
          nonce: "NONCE",
          resourceUri: (p) => `${kCspSource}/${p}`,
          extensionVersion: "1.0.0",
        });
        assert.deepStrictEqual(cspMetas(result), [kExpectedCsp]);
        assert.ok(result.includes('content="1.0.0"'));
        assert.ok(
          /<head[^>]*>\s*<meta name="inspect-extension:version"/.test(result),
          "Policy goes right after the <head> start tag"
        );
        assert.ok(
          result.includes(`<script nonce="NONCE" src="${kCspSource}/./a.js">`)
        );
      });
    }

    test("stripCspMeta leaves other meta tags alone", () => {
      const html =
        '<meta charset="utf-8"><meta http-equiv=\'Content-Security-Policy\' content="x"><meta name="robots" content="noindex">';
      assert.strictEqual(
        stripCspMeta(html),
        '<meta charset="utf-8"><meta name="robots" content="noindex">'
      );
    });

    suite("malformed policy file", () => {
      const withDirectives = (directives: unknown) =>
        JSON.stringify({ version: 1, directives });
      const minimal = {
        "default-src": ["'none'"],
        "script-src": ["'self'"],
        "worker-src": ["'self'"],
      };
      const cases: [string, string][] = [
        ["not JSON", "{"],
        ["not an object", "[]"],
        ["wrong version", JSON.stringify({ version: 2, directives: minimal })],
        ["missing version", JSON.stringify({ directives: minimal })],
        [
          "directives not an object",
          JSON.stringify({ version: 1, directives: [] }),
        ],
        [
          "sources not an array",
          withDirectives({ ...minimal, "img-src": "data:" }),
        ],
        ["non-string source", withDirectives({ ...minimal, "img-src": [1] })],
        ["bad directive name", withDirectives({ ...minimal, "img src": [] })],
        ["semicolon", withDirectives({ ...minimal, "img-src": ["data:;"] })],
        ["comma", withDirectives({ ...minimal, "img-src": ["a,b"] })],
        ["double quote", withDirectives({ ...minimal, "img-src": ['x"y'] })],
        ["stray quote", withDirectives({ ...minimal, "img-src": ["'self"] })],
        ["inner quote", withDirectives({ ...minimal, "img-src": ["'a'b'"] })],
        ["whitespace", withDirectives({ ...minimal, "img-src": ["a b"] })],
        [
          "control char",
          withDirectives({ ...minimal, "img-src": ["a\u0007"] }),
        ],
        [
          "missing script-src",
          withDirectives({ "default-src": ["'none'"], "worker-src": [] }),
        ],
        [
          "missing default-src",
          withDirectives({ "script-src": [], "worker-src": [] }),
        ],
      ];

      for (const [name, text] of cases) {
        test(`rejects ${name}`, () => {
          assert.throws(() => parseViewerCsp(text), ViewerCspError);
        });
      }

      test("accepts the minimal valid policy", () => {
        assert.deepStrictEqual(parseViewerCsp(withDirectives(minimal)), {
          version: 1,
          directives: minimal,
        });
      });

      test("shows an error page instead of the viewer", () => {
        const { viewDir, cleanup } = createTempViewDir(
          kBundledIndex,
          JSON.stringify({ version: 2, directives: minimal })
        );
        try {
          const load = loadViewerCsp(viewDir);
          assert.strictEqual(load.status, "invalid");
          const result = getWebviewPanelHtml(
            toAbsolutePath(viewDir),
            mockPanel,
            "1.0.0",
            null,
            "",
            "Inspect AI"
          );
          assert.ok(
            result.includes(
              "Inspect AI view could not be loaded because its content-security-policy.json is invalid: unsupported version 2 (expected 1)."
            ),
            result
          );
          assert.ok(!result.includes("window.inline"), "Viewer not rendered");
          assert.ok(!result.includes("nonce"), "No viewer scripts allowed");
        } finally {
          cleanup();
        }
      });

      test("treats an unreadable policy path as invalid, not absent", () => {
        const { viewDir, cleanup } = createTempViewDir(kBundledIndex);
        try {
          fs.mkdirSync(path.join(viewDir, kViewerCspFileName));
          assert.strictEqual(loadViewerCsp(viewDir).status, "invalid");
        } finally {
          cleanup();
        }
      });
    });
  });
});
