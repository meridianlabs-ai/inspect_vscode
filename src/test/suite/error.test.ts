/**
 * Tests for components/error.ts — notification text must stay link-inert.
 */
import * as assert from "assert";

import { linkInertText } from "../../components/error";

// VS Code's notification link parser (src/vs/base/common/linkedText.ts),
// copied verbatim: a match becomes a clickable anchor, and a `command:` anchor
// executes the command with the JSON arguments in its query.
const kVsCodeLinkRegex =
  /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)(\3))?\)/gi;

function parsedLinks(text: string): string[] {
  return Array.from(text.matchAll(kVsCodeLinkRegex)).map((m) => m[2] ?? "");
}

suite("showError link neutralisation", () => {
  const kCommandLink =
    '[Open log](command:workbench.action.terminal.sendSequence?{"text":"id\\n"})';

  test("the copied parser recognises an injected command link", () => {
    // Premise check: without neutralisation the regex yields a command href.
    assert.deepStrictEqual(parsedLinks(`The file /${kCommandLink}.eval x`), [
      'command:workbench.action.terminal.sendSequence?{"text":"id\\n"}',
    ]);
  });

  test("neutralises a command link embedded in a path", () => {
    const text = linkInertText(
      `The file /${kCommandLink}.eval does not exist.`
    );
    assert.deepStrictEqual(parsedLinks(text), []);
  });

  test("neutralises https and file links and titled links", () => {
    for (const link of [
      "[Open](https://evil.example/x)",
      "[Open](file:///etc/passwd)",
      '[Open](command:workbench.action.terminal.new "title")',
      "[a](command:x)[b](command:y)",
    ]) {
      assert.deepStrictEqual(parsedLinks(linkInertText(link)), [], link);
    }
  });

  test("backslash escaping alone would not neutralise the parser", () => {
    // Documents why the helper breaks the `](` adjacency instead of escaping:
    // the label may contain a backslash and the regex is not markdown-aware.
    assert.strictEqual(parsedLinks("\\[Open\\](command:x)").length, 1);
  });

  test("leaves the visible text unchanged", () => {
    const text = linkInertText(
      `The file /${kCommandLink}.eval does not exist.`
    );
    assert.strictEqual(
      text.replace(/\u200B/g, ""),
      `The file /${kCommandLink}.eval does not exist.`
    );
  });

  test("does not touch ordinary messages", () => {
    for (const msg of [
      'Unable to open log: unsupported location "ssh:".',
      "The file /logs/2024-01-01T12-00-00+00-00_task_x1.eval does not exist.",
      'Unable to open log: "/etc/passwd" is not an Inspect log file.',
      "Error (code 12) [retrying]",
    ]) {
      assert.strictEqual(linkInertText(msg), msg);
    }
  });
});
