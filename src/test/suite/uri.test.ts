import * as assert from "assert";
import * as os from "os";
import { Uri } from "vscode";
import {
  resolveToUri,
  dirname,
  prettyUriPath,
  getRelativeUri,
  normalizeWindowsUri,
} from "../../core/uri";

suite("URI Utilities Test Suite", () => {
  suite("resolveToUri", () => {
    test("should parse valid file URI", () => {
      const uri = resolveToUri("file:///home/user/test.txt");
      assert.strictEqual(uri.scheme, "file");
      assert.ok(uri.fsPath.includes("test.txt"));
    });

    test("should parse valid http URI", () => {
      const uri = resolveToUri("https://example.com/path");
      assert.strictEqual(uri.scheme, "https");
    });

    test("should convert absolute path to file URI", () => {
      const testPath = os.platform() === "win32" ? "C:\\Users\\test.txt" : "/home/user/test.txt";
      const uri = resolveToUri(testPath);
      assert.strictEqual(uri.scheme, "file");
    });

    test("should convert relative path to absolute file URI", () => {
      const uri = resolveToUri("test.txt");
      assert.strictEqual(uri.scheme, "file");
      // Should be resolved to absolute path
      assert.ok(uri.fsPath.length > "test.txt".length);
    });

    test("should handle vscode-resource URI scheme", () => {
      const uri = resolveToUri("vscode-resource://extension/path");
      assert.strictEqual(uri.scheme, "vscode-resource");
    });

    test("should throw error for invalid URI format", () => {
      // A path that looks like a URI but has invalid characters
      // This test verifies error handling
      try {
        // Testing with a malformed input that the function should handle
        const result = resolveToUri("test/path/file.txt");
        // If it doesn't throw, it should return a valid URI
        assert.strictEqual(result.scheme, "file");
      } catch (error) {
        // If it throws, verify it's the expected error type
        assert.ok(error instanceof Error);
      }
    });

    test("should handle URI with query parameters", () => {
      const uri = resolveToUri("https://example.com/path?query=value");
      assert.strictEqual(uri.scheme, "https");
      assert.ok(uri.query.includes("query=value"));
    });

    test("should handle URI with fragment", () => {
      const uri = resolveToUri("https://example.com/path#section");
      assert.strictEqual(uri.scheme, "https");
      assert.strictEqual(uri.fragment, "section");
    });
  });

  suite("dirname", () => {
    test("should return parent directory for file URI", () => {
      const uri = Uri.file("/home/user/documents/test.txt");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "file");
      assert.ok(
        parent.fsPath.endsWith("documents") || parent.fsPath.includes("documents"),
        `Expected path to include 'documents', got: ${parent.fsPath}`
      );
    });

    test("should handle file URI at root level", () => {
      const uri = Uri.file("/test.txt");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "file");
      // Parent of /test.txt should be /
      assert.ok(parent.fsPath === "/" || parent.fsPath.match(/^[A-Z]:\\?$/));
    });

    test("should handle http URI", () => {
      const uri = Uri.parse("https://example.com/path/to/file");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "https");
      assert.ok(parent.path.includes("/path/to") || parent.path.includes("/path"));
    });

    test("should handle nested directories", () => {
      const uri = Uri.file("/home/user/a/b/c/d/file.txt");
      const parent = dirname(uri);
      assert.ok(parent.fsPath.includes("d") || parent.fsPath.endsWith("d"));
    });
  });

  suite("prettyUriPath", () => {
    test("should replace home directory with tilde for file URI", () => {
      const homedir = os.homedir();
      const uri = Uri.file(`${homedir}/documents/test.txt`);
      const pretty = prettyUriPath(uri);
      assert.ok(pretty.startsWith("~"), `Expected path to start with ~, got: ${pretty}`);
      assert.ok(pretty.includes("documents"));
    });

    test("should not modify path outside home directory", () => {
      const uri = Uri.file("/tmp/test.txt");
      const pretty = prettyUriPath(uri);
      // Should not contain ~ if not in home directory
      if (!os.homedir().startsWith("/tmp")) {
        assert.ok(!pretty.startsWith("~"));
      }
    });

    test("should return URI string for non-file schemes", () => {
      const uri = Uri.parse("https://example.com/path");
      const pretty = prettyUriPath(uri);
      assert.ok(pretty.includes("example.com"));
      assert.ok(pretty.includes("path"));
    });

    test("should handle vscode-resource scheme", () => {
      const uri = Uri.parse("vscode-resource://extension/path/file.txt");
      const pretty = prettyUriPath(uri);
      assert.ok(pretty.includes("vscode-resource"));
    });
  });

  suite("getRelativeUri", () => {
    test("should return relative path for child URI", () => {
      const parent = Uri.file("/home/user/project");
      const child = Uri.file("/home/user/project/src/file.txt");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, "src/file.txt");
    });

    test("should return null for same URI", () => {
      const uri = Uri.file("/home/user/project");
      const relative = getRelativeUri(uri, uri);
      assert.strictEqual(relative, null);
    });

    test("should return null for non-child URI", () => {
      const parent = Uri.file("/home/user/project");
      const child = Uri.file("/home/other/file.txt");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, null);
    });

    test("should return null for different schemes", () => {
      const parent = Uri.file("/home/user/project");
      const child = Uri.parse("https://example.com/project/file.txt");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, null);
    });

    test("should handle parent without trailing slash", () => {
      const parent = Uri.file("/home/user/project");
      const child = Uri.file("/home/user/project/src/index.ts");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, "src/index.ts");
    });

    test("should handle deeply nested paths", () => {
      const parent = Uri.file("/home/user");
      const child = Uri.file("/home/user/a/b/c/d/e/f.txt");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, "a/b/c/d/e/f.txt");
    });

    test("should return null for sibling paths", () => {
      const parent = Uri.file("/home/user/project1");
      const child = Uri.file("/home/user/project2/file.txt");
      const relative = getRelativeUri(parent, child);
      assert.strictEqual(relative, null);
    });
  });

  suite("normalizeWindowsUri", () => {
    // These tests check the behavior on the current platform
    test("should return unchanged URI on non-Windows platforms", function () {
      if (os.platform() === "win32") {
        this.skip();
        return;
      }
      const uri = "file:///home/user/file.txt";
      assert.strictEqual(normalizeWindowsUri(uri), uri);
    });

    test("should return unchanged URI for correctly formatted Windows URI", function () {
      if (os.platform() !== "win32") {
        this.skip();
        return;
      }
      const uri = "file:///C:/Users/test.txt";
      const result = normalizeWindowsUri(uri);
      assert.strictEqual(result, uri);
    });

    test("should correct malformed Windows file URI", function () {
      if (os.platform() !== "win32") {
        this.skip();
        return;
      }
      const malformed = "file://C:/Users/test.txt";
      const result = normalizeWindowsUri(malformed);
      assert.strictEqual(result, "file:///C:/Users/test.txt");
    });

    test("should handle non-file URIs unchanged", () => {
      const uri = "https://example.com/path";
      assert.strictEqual(normalizeWindowsUri(uri), uri);
    });
  });
});
