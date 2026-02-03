import * as assert from "assert";
import { shQuote } from "../../core/string";

suite("String Utilities Test Suite", () => {
  suite("shQuote", () => {
    test("should return unquoted string when no spaces present", () => {
      assert.strictEqual(shQuote("hello"), "hello");
    });

    test("should return unquoted string for empty string", () => {
      assert.strictEqual(shQuote(""), "");
    });

    test("should quote string containing space", () => {
      assert.strictEqual(shQuote("hello world"), '"hello world"');
    });

    test("should quote string containing multiple spaces", () => {
      assert.strictEqual(shQuote("hello my world"), '"hello my world"');
    });

    test("should quote string containing tab character", () => {
      assert.strictEqual(shQuote("hello\tworld"), '"hello\tworld"');
    });

    test("should quote string containing newline character", () => {
      assert.strictEqual(shQuote("hello\nworld"), '"hello\nworld"');
    });

    test("should quote string containing carriage return", () => {
      assert.strictEqual(shQuote("hello\rworld"), '"hello\rworld"');
    });

    test("should quote string with leading space", () => {
      assert.strictEqual(shQuote(" hello"), '" hello"');
    });

    test("should quote string with trailing space", () => {
      assert.strictEqual(shQuote("hello "), '"hello "');
    });

    test("should not quote string with special characters but no whitespace", () => {
      assert.strictEqual(shQuote("hello-world_123"), "hello-world_123");
    });

    test("should not quote path without spaces", () => {
      assert.strictEqual(shQuote("/usr/local/bin"), "/usr/local/bin");
    });

    test("should quote path with spaces", () => {
      assert.strictEqual(
        shQuote("/usr/local/my app/bin"),
        '"/usr/local/my app/bin"'
      );
    });

    test("should handle string with only whitespace", () => {
      assert.strictEqual(shQuote("   "), '"   "');
    });

    test("should handle Windows path with spaces", () => {
      assert.strictEqual(
        shQuote("C:\\Program Files\\My App"),
        '"C:\\Program Files\\My App"'
      );
    });
  });
});
