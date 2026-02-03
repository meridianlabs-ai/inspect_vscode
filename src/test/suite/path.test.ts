/**
 * Tests for path.ts - Path utilities including AbsolutePath
 */
import * as assert from "assert";
import { toAbsolutePath } from "../../core/path";

suite("Path Utilities Test Suite", () => {
  suite("toAbsolutePath", () => {
    test("should create AbsolutePath from string", () => {
      const absPath = toAbsolutePath("/home/user/project");
      assert.strictEqual(absPath.path, "/home/user/project");
    });

    test("should handle paths with spaces", () => {
      const absPath = toAbsolutePath("/home/user/my project/file.py");
      assert.strictEqual(absPath.path, "/home/user/my project/file.py");
    });

    test("should handle paths with special characters", () => {
      const absPath = toAbsolutePath("/home/user/project-v2_final (copy)");
      assert.strictEqual(absPath.path, "/home/user/project-v2_final (copy)");
    });

    test("should handle Windows-style paths", () => {
      const absPath = toAbsolutePath("C:\\Users\\user\\project");
      assert.strictEqual(absPath.path, "C:\\Users\\user\\project");
    });

    test("should handle root paths", () => {
      const absPath = toAbsolutePath("/");
      assert.strictEqual(absPath.path, "/");
    });

    test("should handle empty string", () => {
      const absPath = toAbsolutePath("");
      assert.strictEqual(absPath.path, "");
    });
  });

  suite("AbsolutePath.dirname", () => {
    test("should return parent directory", () => {
      const absPath = toAbsolutePath("/home/user/project/file.py");
      const dirname = absPath.dirname();
      assert.strictEqual(dirname.path, "/home/user/project");
    });

    test("should handle nested directories", () => {
      const absPath = toAbsolutePath("/a/b/c/d/e");
      const dirname = absPath.dirname();
      assert.strictEqual(dirname.path, "/a/b/c/d");
    });

    test("should handle root level file", () => {
      const absPath = toAbsolutePath("/file.py");
      const dirname = absPath.dirname();
      assert.strictEqual(dirname.path, "/");
    });

    test("should return AbsolutePath type", () => {
      const absPath = toAbsolutePath("/home/user/project");
      const dirname = absPath.dirname();
      // Verify it's an AbsolutePath by checking it has the expected methods
      assert.ok(typeof dirname.path === "string");
      assert.ok(typeof dirname.dirname === "function");
      assert.ok(typeof dirname.filename === "function");
      assert.ok(typeof dirname.child === "function");
    });

    test("should be chainable", () => {
      const absPath = toAbsolutePath("/a/b/c/d");
      const grandparent = absPath.dirname().dirname();
      assert.strictEqual(grandparent.path, "/a/b");
    });
  });

  suite("AbsolutePath.filename", () => {
    test("should return filename from path", () => {
      const absPath = toAbsolutePath("/home/user/project/file.py");
      assert.strictEqual(absPath.filename(), "file.py");
    });

    test("should return directory name for directory path", () => {
      const absPath = toAbsolutePath("/home/user/project");
      assert.strictEqual(absPath.filename(), "project");
    });

    test("should handle filenames with multiple dots", () => {
      const absPath = toAbsolutePath("/home/user/archive.tar.gz");
      assert.strictEqual(absPath.filename(), "archive.tar.gz");
    });

    test("should handle hidden files (dot prefix)", () => {
      const absPath = toAbsolutePath("/home/user/.gitignore");
      assert.strictEqual(absPath.filename(), ".gitignore");
    });

    test("should handle filenames with spaces", () => {
      const absPath = toAbsolutePath("/home/user/my file.txt");
      assert.strictEqual(absPath.filename(), "my file.txt");
    });

    test("should handle Windows path separators", () => {
      const absPath = toAbsolutePath("C:\\Users\\user\\file.py");
      // On non-Windows, this might return the whole path or just the filename
      // depending on path.basename behavior
      const filename = absPath.filename();
      assert.ok(filename.includes("file.py") || filename === "C:\\Users\\user\\file.py");
    });
  });

  suite("AbsolutePath.child", () => {
    test("should join child path to parent", () => {
      const absPath = toAbsolutePath("/home/user");
      const child = absPath.child("project");
      assert.strictEqual(child.path, "/home/user/project");
    });

    test("should handle nested children", () => {
      const absPath = toAbsolutePath("/home");
      const nested = absPath.child("user").child("project").child("file.py");
      assert.strictEqual(nested.path, "/home/user/project/file.py");
    });

    test("should handle child with subdirectories", () => {
      const absPath = toAbsolutePath("/home/user");
      const child = absPath.child("project/src/main.py");
      // path.join should handle this
      assert.ok(child.path.includes("project"));
      assert.ok(child.path.includes("main.py"));
    });

    test("should return AbsolutePath type", () => {
      const absPath = toAbsolutePath("/home/user");
      const child = absPath.child("project");
      assert.ok(typeof child.path === "string");
      assert.ok(typeof child.dirname === "function");
      assert.ok(typeof child.filename === "function");
      assert.ok(typeof child.child === "function");
    });

    test("should handle empty child name", () => {
      const absPath = toAbsolutePath("/home/user");
      const child = absPath.child("");
      assert.strictEqual(child.path, "/home/user");
    });

    test("should handle child with special characters", () => {
      const absPath = toAbsolutePath("/home/user");
      const child = absPath.child("file (1).py");
      assert.strictEqual(child.path, "/home/user/file (1).py");
    });
  });

  suite("AbsolutePath chaining operations", () => {
    test("should support dirname then child", () => {
      const absPath = toAbsolutePath("/home/user/project/old");
      const sibling = absPath.dirname().child("new");
      assert.strictEqual(sibling.path, "/home/user/project/new");
    });

    test("should support child then dirname then filename", () => {
      const absPath = toAbsolutePath("/home/user");
      const result = absPath.child("project").child("file.py").dirname().filename();
      assert.strictEqual(result, "project");
    });

    test("should maintain immutability", () => {
      const original = toAbsolutePath("/home/user");
      const child = original.child("project");
      const dirname = original.dirname();

      // Original should be unchanged
      assert.strictEqual(original.path, "/home/user");
      assert.strictEqual(child.path, "/home/user/project");
      assert.strictEqual(dirname.path, "/home");
    });
  });

  suite("Edge cases", () => {
    test("should handle trailing slashes", () => {
      const absPath = toAbsolutePath("/home/user/project/");
      // path.dirname and basename handle trailing slashes
      assert.ok(absPath.path === "/home/user/project/");
    });

    test("should handle paths with consecutive slashes", () => {
      const absPath = toAbsolutePath("/home//user///project");
      // The path is stored as-is, operations use path module
      assert.ok(absPath.path.includes("home"));
    });

    test("should handle unicode characters in paths", () => {
      const absPath = toAbsolutePath("/home/user/проект/файл.py");
      assert.strictEqual(absPath.path, "/home/user/проект/файл.py");
      assert.strictEqual(absPath.filename(), "файл.py");
    });

    test("should handle very long paths", () => {
      const longSegment = "a".repeat(100);
      const longPath = `/home/${longSegment}/${longSegment}/${longSegment}`;
      const absPath = toAbsolutePath(longPath);
      assert.strictEqual(absPath.path, longPath);
    });

    test("should handle path with dots (. and ..)", () => {
      // Note: toAbsolutePath doesn't normalize, it stores as-is
      // path.join might normalize when using child()
      const absPath = toAbsolutePath("/home/user/../other");
      assert.ok(absPath.path.includes(".."));
    });
  });
});
