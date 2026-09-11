/**
 * Tests for core/markdown.ts — untrusted values interpolated into tooltip
 * MarkdownStrings must render as literal text.
 */
import * as assert from "assert";

import { marked } from "marked";

import { codeFence, escapeMarkdown } from "../../core/markdown";

// `marked` is pinned to the version VS Code 1.93 bundles for MarkdownString
// rendering (src/vs/base/common/marked/marked.js), in its default GFM mode,
// so these tests exercise the tokenizer that decides what becomes a link.
function render(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true });
}

// How marked HTML-encodes text content, so a rendered paragraph can be
// compared byte-for-byte against the literal it should contain.
function htmlText(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (c) => entities[c] ?? c);
}

// Tooltip shapes from log-listing-server-queue.ts / scan-listing-provider.ts.
function tooltip(value: string): string {
  return [
    `### ${escapeMarkdown(value)} - ${escapeMarkdown(value)}`,
    "",
    `status:&nbsp;${escapeMarkdown(value)}  `,
    `dataset: ${escapeMarkdown(value)}`,
    `scan_id=${escapeMarkdown(value)}  `,
  ].join("\n");
}

suite("escapeMarkdown", () => {
  const kUntrustedValues = [
    "https://evil.example/login",
    "http://3232235777/x",
    "HTTPS://EVIL.EXAMPLE/X",
    "ftp://host/x",
    "www.evil.example/x",
    "user@evil.example",
    "<https://evil.example/>",
    "[phish](https://evil.example)",
    "![beacon](https://evil.example/p.png)",
    "https://evil.example/a](https://evil.example/b)",
    "# heading",
    "`code` **bold** _em_ ~~del~~",
    "| a | b |",
  ];

  test("renders no links or images for untrusted values", () => {
    for (const value of kUntrustedValues) {
      const html = render(tooltip(value));
      assert.ok(!/<a[\s>]/i.test(html), `link rendered for ${value}: ${html}`);
      assert.ok(
        !/<img[\s>]/i.test(html),
        `image rendered for ${value}: ${html}`
      );
    }
  });

  test("bare URLs autolink without the escape (premise)", () => {
    const html = render("task: https://evil.example/login");
    assert.ok(/<a\s/i.test(html), html);
  });

  test("renders the original value as literal text", () => {
    for (const value of [
      ...kUntrustedValues,
      "plain task name",
      "task_v1.2 (final)",
      "gpt-4o-mini",
      "localhost:8080/x",
    ]) {
      // Exactly one paragraph whose content is the value, encoded as text:
      // nothing else (no link, image, heading, code or table) was produced.
      assert.strictEqual(
        render(`para: ${escapeMarkdown(value)}`),
        `<p>para: ${htmlText(value)}</p>\n`
      );
    }
  });

  test("escapes every metacharacter it claims to", () => {
    const meta = "\\`*_{}[]()#+-.!<>|~:";
    assert.strictEqual(
      escapeMarkdown(meta),
      meta
        .split("")
        .map((c) => `\\${c}`)
        .join("")
    );
    assert.strictEqual(escapeMarkdown("plain text 123"), "plain text 123");
  });
});

suite("codeFence", () => {
  test("fences content with a run longer than any embedded backtick run", () => {
    const fenced = codeFence("a\n````\nb").join("\n");
    assert.ok(fenced.startsWith("`````\n"), fenced);
    const html = render(fenced);
    assert.ok(/<pre><code>/.test(html), html);
    assert.ok(!/<a[\s>]/i.test(render(codeFence("https://x.y/z").join("\n"))));
  });
});
