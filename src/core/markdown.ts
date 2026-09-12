/**
 * Helpers for embedding untrusted text into markdown rendered by VS Code
 * (`MarkdownString`).
 *
 * Eval log and scan fields (task/model/dataset/scorer names, task_args, scan
 * ids, ...) originate from shared artifacts an attacker can control, and they
 * are string-interpolated into tooltip markdown. Even with `isTrusted` false
 * (command links inert, HTML sanitized) the renderer still processes links,
 * images, headings and code fences — enough for phishing and hover-triggered
 * image beacons. These helpers keep untrusted values inert.
 */

/**
 * Escape markdown metacharacters so a value renders as literal text: no links
 * or images (hover beacons), headings, emphasis, tables, or inline code.
 *
 * `:` is escaped too: the renderer's GFM autolinker turns a bare
 * `scheme://host/path` into a link even with `isTrusted` false, and it strips
 * backslash escapes from the resulting href, so escaping the `.` in the host
 * is not enough (and a host need not contain one — `http://3232235777/`).
 * `www.` and e-mail autolinks require an unescaped `.` and stay inert.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!<>|~:]/g, "\\$&");
}

/**
 * Wrap untrusted multi-line content in a fenced code block that it cannot break
 * out of. The fence is made one backtick longer than the longest backtick run
 * in the content, so per CommonMark's fence rules no embedded run — indented or
 * not — can close the block early (the previous fixed ``` fence let a value
 * containing an indented ``` line escape into arbitrary markdown).
 */
export function codeFence(content: string): string[] {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, content, fence];
}
