import { window } from "vscode";

/**
 * Make text inert for VS Code's non-modal notifications.
 *
 * Notification messages are not plain text: VS Code runs them through its
 * linked-text parser, which turns `[label](command:...)`, `[label](https://...)`
 * and `[label](file:...)` into clickable anchors — and a `command:` anchor
 * executes that command with the JSON arguments in its query. Error text
 * routinely embeds untrusted values (URI paths from the OS URL handler or
 * terminal output, server responses), so any such value must not be able to
 * spell a link.
 *
 * The parser is a regex, not markdown, so backslash-escaping does nothing;
 * every match it can make contains a literal `](`. Inserting a zero-width
 * space between the two characters breaks that adjacency while leaving the
 * visible text unchanged.
 */
export function linkInertText(text: string): string {
  return text.replace(/\]\(/g, "]\u200B(");
}

/**
 * Show an error notification. The message (and `error.message`) is made
 * link-inert, so callers may safely interpolate untrusted values into `msg`.
 */
export async function showError(msg: string, error?: Error) {
  const message = [msg];
  if (error) {
    message.push(error.message);
  }
  await window.showErrorMessage(linkInertText(message.join("\n")), "Ok");
}
