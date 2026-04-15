import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";

import { Uri } from "vscode";

import { toAbsolutePath } from "../../core/path";
import { getWebviewPanelHtml } from "../../core/webview";
import { HostWebviewPanel } from "../../hooks";

/**
 * Integration tests that verify installed Scout/Inspect packages have valid
 * view assets. These tests are automatically skipped when the corresponding
 * package is not installed.
 */

/**
 * Try to locate a binary on PATH using `which` (macOS/Linux) or `where` (Windows).
 */
function findBinary(name: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [name], {
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim().split("\n")[0];
  }
  return null;
}

/**
 * Get the package version info (version string + install path) from an
 * inspect-family binary. Returns null if the binary is missing or the
 * command fails.
 */
function getPackageVersionInfo(
  binaryName: string
): { version: string; path: string } | null {
  const binPath = findBinary(binaryName);
  if (!binPath) {
    return null;
  }
  try {
    const result = spawnSync(binPath, ["info", "version", "--json"], {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return JSON.parse(result.stdout.trim()) as {
        version: string;
        path: string;
      };
    }
  } catch {
    // binary found but command failed
  }
  return null;
}

/**
 * Resolve the view directory for a package, checking multiple known locations
 * (mirrors the logic in packageViewPath).
 */
function resolveViewDir(packagePath: string): string | null {
  const candidates = [
    // Newest location: _view/dist
    `${packagePath}/_view/dist`,
    // Bundled location: _view/www/dist
    `${packagePath}/_view/www/dist`,
    // Legacy unbundled: _view/www
    `${packagePath}/_view/www`,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Create a minimal mock HostWebviewPanel for testing.
 */
function createMockPanel(): HostWebviewPanel {
  return {
    webview: {
      cspSource: "https://mock.vscode-resource.test",
      asWebviewUri: (uri: Uri) => uri,
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

suite("View Path Integration Tests", () => {
  const mockPanel = createMockPanel();

  suite("Inspect AI view assets", () => {
    let viewDir: string | null = null;
    let packageInfo: { version: string; path: string } | null = null;

    suiteSetup(function () {
      packageInfo = getPackageVersionInfo("inspect");
      if (!packageInfo) {
        this.skip();
        return;
      }
      viewDir = resolveViewDir(packageInfo.path);
      if (!viewDir) {
        this.skip();
      }
    });

    test("view directory contains index.html", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const indexPath = `${viewDir}/index.html`;
      assert.ok(
        fs.existsSync(indexPath),
        `index.html should exist at ${indexPath}`
      );
    });

    test("index.html contains valid HTML (not LFS pointer)", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const content = fs.readFileSync(`${viewDir}/index.html`, "utf-8");
      assert.ok(
        content.includes("<html"),
        "index.html should contain <html tag (not an LFS pointer)"
      );
      assert.ok(
        !content.includes("git-lfs.github.com"),
        "index.html should not be a Git LFS pointer file"
      );
    });

    test("getWebviewPanelHtml produces valid output with real view path", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const result = getWebviewPanelHtml(
        toAbsolutePath(viewDir),
        mockPanel,
        "1.0.0",
        null,
        "",
        "Inspect AI"
      );

      assert.ok(result.includes("<html"), "Should contain <html tag");
      assert.ok(
        result.includes("Content-Security-Policy"),
        "Should inject CSP meta tag"
      );
      assert.ok(
        !result.includes("Please update to a newer version"),
        "Should NOT show upgrade message for valid install"
      );
    });
  });

  suite("Inspect Scout view assets", () => {
    let viewDir: string | null = null;
    let packageInfo: { version: string; path: string } | null = null;

    suiteSetup(function () {
      packageInfo = getPackageVersionInfo("scout");
      if (!packageInfo) {
        this.skip();
        return;
      }
      viewDir = resolveViewDir(packageInfo.path);
      if (!viewDir) {
        this.skip();
      }
    });

    test("view directory contains index.html", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const indexPath = `${viewDir}/index.html`;
      assert.ok(
        fs.existsSync(indexPath),
        `index.html should exist at ${indexPath}`
      );
    });

    test("index.html contains valid HTML (not LFS pointer)", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const content = fs.readFileSync(`${viewDir}/index.html`, "utf-8");
      assert.ok(
        content.includes("<html"),
        "index.html should contain <html tag (not an LFS pointer)"
      );
      assert.ok(
        !content.includes("git-lfs.github.com"),
        "index.html should not be a Git LFS pointer file"
      );
    });

    test("getWebviewPanelHtml produces valid output with real view path", function () {
      if (!viewDir) {
        this.skip();
        return;
      }
      const result = getWebviewPanelHtml(
        toAbsolutePath(viewDir),
        mockPanel,
        "1.0.0",
        null,
        "",
        "Inspect Scout"
      );

      assert.ok(result.includes("<html"), "Should contain <html tag");
      assert.ok(
        result.includes("Content-Security-Policy"),
        "Should inject CSP meta tag"
      );
      assert.ok(
        !result.includes("Please update to a newer version"),
        "Should NOT show upgrade message for valid install"
      );
    });
  });
});
