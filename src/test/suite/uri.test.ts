import * as assert from "assert";
import { spawnSync } from "child_process";
import * as os from "os";

import { Uri } from "vscode";

import {
  dirname,
  getRelativeUri,
  isUncPath,
  normalizeWindowsUri,
  parseLocationLiterally,
  parseTerminalLinkUri,
  percentDecodeOnce,
  prettyUriPath,
  resolveToUri,
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
      const testPath =
        os.platform() === "win32"
          ? "C:\\Users\\test.txt"
          : "/home/user/test.txt";
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

  suite("percentDecodeOnce", () => {
    test("decodes well-formed escapes once, as urllib.parse.unquote does", () => {
      assert.strictEqual(
        percentDecodeOnce("/w/my%20run/x.eval"),
        "/w/my run/x.eval"
      );
      assert.strictEqual(percentDecodeOnce("..%2F..%2Fetc"), "../../etc");
      assert.strictEqual(percentDecodeOnce("%2e%2E"), "..");
      // one decode only: `%2520` is the three characters `%20`
      assert.strictEqual(percentDecodeOnce("run%25201.eval"), "run%201.eval");
      // multi-byte UTF-8 across adjacent escapes
      assert.strictEqual(percentDecodeOnce("caf%C3%A9.eval"), "café.eval");
      assert.strictEqual(percentDecodeOnce("caf\u00e9%20x"), "café x");
    });

    test("passes values without escapes through unchanged", () => {
      assert.strictEqual(
        percentDecodeOnce("/w/logs/run 1.eval"),
        "/w/logs/run 1.eval"
      );
      assert.strictEqual(percentDecodeOnce(""), "");
    });

    test("keeps malformed escapes literal instead of throwing", () => {
      assert.strictEqual(percentDecodeOnce("100%done.eval"), "100%done.eval");
      assert.strictEqual(percentDecodeOnce("%zz.eval"), "%zz.eval");
      assert.strictEqual(percentDecodeOnce("50%"), "50%");
      assert.strictEqual(percentDecodeOnce("a%2"), "a%2");
      // mixed: the well-formed escape decodes, the malformed one stays
      assert.strictEqual(percentDecodeOnce("100%done%20x"), "100%done x");
    });

    test("returns null for escapes that do not decode to UTF-8", () => {
      assert.strictEqual(percentDecodeOnce("%E0%A4%A"), null);
      assert.strictEqual(percentDecodeOnce("%C3.eval"), null);
      assert.strictEqual(percentDecodeOnce("%FF"), null);
    });

    test("keeps U+FEFF as a file-name character, as unquote does", () => {
      // `%EF%BB%BF` is the UTF-8 form of U+FEFF. TextDecoder drops it as a
      // byte-order mark at the start of a decode unless told otherwise, and
      // every `%XX` run is its own decode, so the character would vanish from
      // the middle of a path too. Python keeps it, so the guard must as well.
      assert.strictEqual(
        percentDecodeOnce("/w/logs/%EF%BB%BFrun.eval"),
        "/w/logs/\ufeffrun.eval"
      );
      assert.strictEqual(
        percentDecodeOnce("file:///w/logs/%EF%BB%BFrun.eval"),
        "file:///w/logs/\ufeffrun.eval"
      );
      assert.strictEqual(
        percentDecodeOnce("/w/%EF%BB%BFlogs/private.eval"),
        "/w/\ufefflogs/private.eval"
      );
      assert.strictEqual(percentDecodeOnce("%EF%BB%BF"), "\ufeff");
      // also when the mark follows other bytes in the same run, or a
      // malformed escape splits the run
      assert.strictEqual(
        percentDecodeOnce("caf%C3%A9%EF%BB%BF.eval"),
        "caf\u00e9\ufeff.eval"
      );
      assert.strictEqual(percentDecodeOnce("%EF%BB%BF%20x"), "\ufeff x");
      assert.strictEqual(
        percentDecodeOnce("50%%EF%BB%BFdone.eval"),
        "50%\ufeffdone.eval"
      );
      // a raw U+FEFF passes through untouched either way
      assert.strictEqual(
        percentDecodeOnce("/w/logs/\ufeffrun%201.eval"),
        "/w/logs/\ufeffrun 1.eval"
      );
      assert.strictEqual(
        percentDecodeOnce("/w/logs/\ufeffrun.eval"),
        "/w/logs/\ufeffrun.eval"
      );
    });

    test("agrees with urllib.parse.unquote on a differential corpus", function () {
      // The predicate exists to judge a location the way the view server's
      // `normalize_uri`/`unquote` will read it, so check that directly against
      // the Python function rather than a JavaScript approximation of it.
      // Where the decoded bytes are not UTF-8 the two differ by design: Python
      // substitutes U+FFFD, this function returns null and the caller refuses.
      const corpus = [
        "/w/logs/run.eval",
        "/w/my%20run/x.eval",
        "..%2F..%2Fetc",
        "%2e%2E",
        "run%25201.eval",
        "caf%C3%A9.eval",
        "caf\u00e9%20x",
        "100%done.eval",
        "%zz.eval",
        "50%",
        "a%2",
        "100%done%20x",
        "/w/logs/%EF%BB%BFrun.eval",
        "file:///w/logs/%EF%BB%BFrun.eval",
        "/w/%EF%BB%BFlogs/private.eval",
        "%EF%BB%BF",
        "caf%C3%A9%EF%BB%BF.eval",
        "%EF%BB%BF%20x",
        "50%%EF%BB%BFdone.eval",
        "/w/logs/\ufeffrun%201.eval",
        "%E0%A4%A",
        "%C3.eval",
        "%FF",
      ];
      // `-X utf8` so stdin/stdout are UTF-8 on Windows too (the corpus has a
      // literal `é`, which a cp1252 stdin would read as two other characters).
      const python = spawnSync(
        process.platform === "win32" ? "python" : "python3",
        [
          "-X",
          "utf8",
          "-c",
          "import json, sys, urllib.parse\n" +
            "print(json.dumps([urllib.parse.unquote(v) for v in json.load(sys.stdin)]))",
        ],
        { input: JSON.stringify(corpus), encoding: "utf8", timeout: 30000 }
      );
      if (
        python.error &&
        "code" in python.error &&
        python.error.code === "ENOENT"
      ) {
        this.skip();
      }
      assert.strictEqual(python.status, 0, python.stderr);
      const unquoted = JSON.parse(python.stdout) as string[];
      assert.strictEqual(unquoted.length, corpus.length);
      corpus.forEach((value, i) => {
        const decoded = percentDecodeOnce(value);
        if (decoded === null) {
          assert.ok(
            unquoted[i]!.includes("\ufffd"),
            `${value}: Python must have substituted U+FFFD, got ${JSON.stringify(unquoted[i])}`
          );
        } else {
          assert.strictEqual(decoded, unquoted[i], value);
        }
      });
      // and the corpus exercised both branches
      assert.ok(corpus.some((v) => percentDecodeOnce(v) === null));
      assert.ok(unquoted.some((v) => v.includes("\ufeff")));
    });
  });

  suite("parseLocationLiterally", () => {
    test("keeps a percent character in a URI as part of the path", () => {
      assert.strictEqual(
        parseLocationLiterally("file:///w/logs/run%201.eval").path,
        "/w/logs/run%201.eval"
      );
      assert.strictEqual(
        Uri.parse("file:///w/logs/run%201.eval").path,
        "/w/logs/run 1.eval",
        "Uri.parse decodes, which is what this helper avoids"
      );
      assert.strictEqual(
        parseLocationLiterally("s3://bucket/a%20b/x.eval").path,
        "/a%20b/x.eval"
      );
      assert.strictEqual(
        parseLocationLiterally("file:///w/logs/100%done.eval").path,
        "/w/logs/100%done.eval"
      );
    });

    test("keeps other characters and the scheme/authority", () => {
      const uri = parseLocationLiterally("file:///w/logs/run 1.eval");
      assert.strictEqual(uri.scheme, "file");
      assert.strictEqual(uri.authority, "");
      assert.strictEqual(uri.path, "/w/logs/run 1.eval");
      assert.strictEqual(
        uri.toString(),
        Uri.file("/w/logs/run 1.eval").toString()
      );
      const s3 = parseLocationLiterally("s3://bucket/logs");
      assert.strictEqual(s3.authority, "bucket");
      assert.strictEqual(s3.path, "/logs");
    });

    test("resolves bare paths like resolveToUri (already literal)", () => {
      assert.strictEqual(
        parseLocationLiterally("/w/logs/100%done.eval").toString(),
        resolveToUri("/w/logs/100%done.eval").toString()
      );
      assert.strictEqual(
        parseLocationLiterally("/w/logs/run%201.eval").path,
        "/w/logs/run%201.eval"
      );
    });
  });

  suite("dirname", () => {
    test("should return parent directory for file URI", () => {
      const uri = Uri.file("/home/user/documents/test.txt");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "file");
      assert.ok(
        parent.fsPath.endsWith("documents") ||
          parent.fsPath.includes("documents"),
        `Expected path to include 'documents', got: ${parent.fsPath}`
      );
    });

    test("should handle file URI at root level", () => {
      const uri = Uri.file("/test.txt");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "file");
      // Parent of /test.txt should be a root: "/" on POSIX, a drive root or
      // bare backslash root on Windows.
      assert.ok(
        parent.fsPath === "/" ||
          parent.fsPath === "\\" ||
          !!parent.fsPath.match(/^[A-Z]:\\?$/i),
        `Expected root, got: ${parent.fsPath}`
      );
    });

    test("should handle http URI", () => {
      const uri = Uri.parse("https://example.com/path/to/file");
      const parent = dirname(uri);
      assert.strictEqual(parent.scheme, "https");
      assert.ok(
        parent.path.includes("/path/to") || parent.path.includes("/path")
      );
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
      assert.ok(
        pretty.startsWith("~"),
        `Expected path to start with ~, got: ${pretty}`
      );
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

    test("should return null for a sibling sharing a string prefix", () => {
      // '.../logs' must not be judged to contain '.../logs-evil/...'
      const parent = Uri.file("/w/logs");
      const child = Uri.file("/w/logs-evil/a.eval");
      assert.strictEqual(getRelativeUri(parent, child), null);
    });

    test("should return null when '..' traversal escapes the parent", () => {
      const parent = Uri.file("/w/logs");
      const child = Uri.file("/w/logs/../../etc/passwd");
      assert.strictEqual(getRelativeUri(parent, child), null);
    });

    test("should return null for backslash '..' traversal (Windows)", () => {
      // Backslash is a separator for downstream Windows consumers; a child using
      // it to escape must be rejected even though path.posix ignores it.
      const parent = Uri.parse("file:///c:/repo/logs");
      const child = Uri.parse(
        "file:///c:/repo/logs/..%5C..%5C..%5CUsers/victim/.ssh/id_rsa"
      );
      assert.strictEqual(getRelativeUri(parent, child), null);
    });

    test("should resolve interior '..' that stays within the parent", () => {
      const parent = Uri.file("/w/logs");
      const child = Uri.file("/w/logs/sub/../a.eval");
      assert.strictEqual(getRelativeUri(parent, child), "a.eval");
    });

    test("should return null for a different S3 bucket (authority)", () => {
      const parent = Uri.parse("s3://bucket-a/logs");
      const child = Uri.parse("s3://bucket-b/logs/x.eval");
      assert.strictEqual(getRelativeUri(parent, child), null);
    });

    test("should relativize within the same S3 bucket", () => {
      const parent = Uri.parse("s3://bucket-a/logs");
      const child = Uri.parse("s3://bucket-a/logs/x.eval");
      assert.strictEqual(getRelativeUri(parent, child), "x.eval");
    });

    test("should return null when '..' escapes an S3 prefix", () => {
      const parent = Uri.parse("s3://bucket-a/logs");
      const child = Uri.parse("s3://bucket-a/logs/../secrets/x.eval");
      assert.strictEqual(getRelativeUri(parent, child), null);
    });

    test("folds the drive letter's case on Windows only", function () {
      // Uri.file keeps the caller's drive-letter case in `.path` while
      // Uri.toString() lower-cases it, so the same Windows directory arrives
      // as both `/C:/w/logs` and `/c:/w/logs`.
      const upper = Uri.parse("file:///C:/w/logs");
      const lower = Uri.parse("file:///c:/w/logs/x.eval");
      if (os.platform() === "win32") {
        assert.strictEqual(getRelativeUri(upper, lower), "x.eval");
        assert.strictEqual(
          getRelativeUri(Uri.parse("file:///c:/w/logs"), upper),
          null,
          "a directory still does not contain itself"
        );
        // only the drive letter is folded: the rest of the path is compared
        // as spelled, so a differing directory case is refused (fail closed)
        assert.strictEqual(
          getRelativeUri(upper, Uri.parse("file:///c:/W/logs/x.eval")),
          null
        );
        // and a non-drive path is left alone
        assert.strictEqual(
          getRelativeUri(
            Uri.parse("file:///Cx/logs"),
            Uri.parse("file:///cx/logs/x.eval")
          ),
          null
        );
      } else {
        // `/c:` is an ordinary, case-sensitive directory name on POSIX
        assert.strictEqual(getRelativeUri(upper, lower), null);
      }
      // the s3 scheme is never folded
      assert.strictEqual(
        getRelativeUri(
          Uri.parse("s3://bucket/C:/logs"),
          Uri.parse("s3://bucket/c:/logs/x.eval")
        ),
        null
      );
    });
  });

  suite("parseTerminalLinkUri", () => {
    test("accepts remote backend schemes", () => {
      assert.ok(parseTerminalLinkUri("s3://bucket/x.eval"));
      assert.ok(parseTerminalLinkUri("https://example.com/x.eval"));
      assert.ok(parseTerminalLinkUri("http://example.com/x.eval"));
    });

    test("accepts a local file:// URI without an authority", () => {
      assert.ok(parseTerminalLinkUri("file:///Users/me/x.eval"));
    });

    test("rejects a file:// URI with a host (UNC / NTLM leak)", () => {
      assert.strictEqual(
        parseTerminalLinkUri("file://attacker.example/share/x.eval"),
        null
      );
    });

    test("rejects unexpected schemes", () => {
      assert.strictEqual(
        parseTerminalLinkUri("vscode://ukaisi.inspect-ai/open"),
        null
      );
      assert.strictEqual(parseTerminalLinkUri("ssh://host/x.eval"), null);
    });
  });

  suite("isUncPath", () => {
    test("detects backslash and forward-slash UNC forms", () => {
      assert.strictEqual(isUncPath("\\\\attacker\\share\\x.json"), true);
      assert.strictEqual(isUncPath("//attacker/share/x.json"), true);
    });

    test("does not flag ordinary absolute/relative paths", () => {
      assert.strictEqual(isUncPath("/Users/me/x.json"), false);
      assert.strictEqual(isUncPath("logs/x.json"), false);
      assert.strictEqual(isUncPath("C:\\logs\\x.json"), false);
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
