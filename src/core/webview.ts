import { readFileSync } from "fs";

import { Disposable, env, MessageItem, Uri, window, workspace } from "vscode";

import { HostWebviewPanel } from "../hooks";

import { getNonce } from "./nonce";
import { AbsolutePath, workspacePath } from "./path";
import { getRelativeUri } from "./uri";

// Schemes the webview is allowed to open via env.openExternal. Web links only;
// vscode://, file://, and OS-registered custom schemes are refused.
const kOpenExternalSchemes = ["http", "https", "mailto"];

/**
 * Serialize a value to JSON for embedding inside an inline `<script>` element.
 *
 * `JSON.stringify` does not escape HTML-significant characters, so a string
 * value containing `</script>` (e.g. an attacker-controlled field persisted via
 * the webview's setState) would otherwise terminate the script element and
 * inject live markup into the webview. Escaping `<`, `>`, `&` — plus the
 * U+2028/U+2029 line separators that are invalid in JS string literals — keeps
 * the serialized payload inert as HTML regardless of its contents.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

// Whether an absolute path resolves inside one of the open workspace folders.
function isWithinWorkspace(absPath: string): boolean {
  const target = Uri.file(absPath);
  return (workspace.workspaceFolders ?? []).some(
    (folder) =>
      folder.uri.fsPath === absPath ||
      getRelativeUri(folder.uri, target) !== null
  );
}

export function getWebviewPanelHtml(
  viewDir: AbsolutePath | null,
  panel: HostWebviewPanel,
  extensionVersion: string,
  unbundledCssOverride: Uri | null = null,
  extraHead: string = "",
  packageName: string = "the package"
): string {
  // read the index.html from the log view directory
  if (viewDir) {
    // get nonce
    const nonce = getNonce();

    // file uri for view dir
    const viewDirUri = Uri.file(viewDir.path);

    // get base html
    let indexHtml = readFileSync(viewDir.child("index.html").path, "utf-8");

    // If the index.html doesn't contain HTML looking text, then it is likely
    // a git lfs pointer file. This can happen if the user is running 0.4.22, which
    // will not have the 'dist' server endpoint but may have lfs files where the
    // view assets are stored. In this case, show a message about updating the version.
    const isHtml = indexHtml.includes("<html");
    if (!isHtml) {
      return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
</head>
<body>
Please update to a newer version of ${packageName} to view this content.
</body>
</html>`;
    }

    // Determine whether this is the old unbundled version of the html or the new
    // bundled version
    const isUnbundled = indexHtml.match(/"\.(\/App\.mjs)"/g);

    const overrideCssHtml =
      isUnbundled && unbundledCssOverride
        ? `<link rel="stylesheet" type ="text/css" href="${unbundledCssOverride.toString()}" >`
        : "";

    // decorate the html tag
    indexHtml = indexHtml.replace("<html ", '<html class="vscode" ');

    // add content security policy
    indexHtml = indexHtml.replace(
      "<head>\n",
      `<head>
          <meta name="inspect-extension:version" content="${extensionVersion}">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
      panel.webview.cspSource
    } data:; font-src ${panel.webview.cspSource} data:; style-src ${
      panel.webview.cspSource
    } 'unsafe-inline'; worker-src 'self' ${
      panel.webview.cspSource
    } blob:; script-src 'nonce-${nonce}' 'unsafe-eval'; script-src-elem 'nonce-${nonce}' ${
      panel.webview.cspSource
    }; connect-src ${panel.webview.cspSource} blob:;">
    ${overrideCssHtml}
    <!--inspect-extra-head-->

    `
    );

    // nonces for scripts. Match the `<script` start tag followed by a tag
    // boundary (whitespace or `>`) so we don't accidentally match tags like
    // `<scripting>`. Case-insensitive and covers all whitespace forms.
    //
    // IMPORTANT: stamp nonces BEFORE inserting the caller-supplied `extraHead`
    // fragment. Otherwise any `<script>` element injected into `extraHead`
    // (e.g. by a value that broke out of an inline JSON payload) would receive
    // a valid CSP nonce and execute. Only scripts from the trusted index.html
    // template should be granted the nonce.
    indexHtml = indexHtml.replace(
      /<script(?=[\s>])/gi,
      (match) => `${match} nonce="${nonce}"`
    );

    // insert the (untrusted) extra head fragment only after nonces have been
    // stamped, so its scripts are not nonced and remain blocked by the CSP.
    indexHtml = indexHtml.replace("<!--inspect-extra-head-->", () => extraHead);

    // function to resolve resource uri
    const resourceUri = (path: string) =>
      panel.webview.asWebviewUri(Uri.joinPath(viewDirUri, path)).toString();

    // Determine whether this is the old index.html format (before bundling),
    // or the newer one. Fix up the html properly in each case

    if (isUnbundled) {
      // Old unbundle html
      // fixup css references
      indexHtml = indexHtml.replace(/href="\.([^"]+)"/g, (_, p1: string) => {
        return `href="${resourceUri(p1)}"`;
      });

      // fixup js references
      indexHtml = indexHtml.replace(/src="\.([^"]+)"/g, (_, p1: string) => {
        return `src="${resourceUri(p1)}"`;
      });

      // fixup import maps
      indexHtml = indexHtml.replace(
        /": "\.([^?"]+)(["?])/g,
        (_, p1: string, p2: string) => {
          return `": "${resourceUri(p1)}${p2}`;
        }
      );

      // fixup App.mjs
      indexHtml = indexHtml.replace(/"\.(\/App\.mjs)"/g, (_, p1: string) => {
        return `"${resourceUri(p1)}"`;
      });
    } else {
      // New bundled html
      // fixup css references
      indexHtml = indexHtml.replace(/href="([^"]+)"/g, (_, p1: string) => {
        return `href="${resourceUri(p1)}"`;
      });

      // fixup js references
      indexHtml = indexHtml.replace(/src="([^"]+)"/g, (_, p1: string) => {
        return `src="${resourceUri(p1)}"`;
      });
    }

    return indexHtml;
  } else {
    return getMessagePanelHtml(
      `${packageName} view is not available.\n\nEnsure that the required Python package is installed in the active Python interpreter (or select a Python interpreter that includes it), then try again.`
    );
  }
}

/**
 * Minimal static HTML for showing an informational message in a webview
 * panel (e.g. when the view can't be rendered). The message is escaped and
 * rendered as plain text; blank lines separate paragraphs.
 */
export function getMessagePanelHtml(message: string): string {
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const paragraphs = message
    .split("\n\n")
    .map((para) => `<p>${escapeHtml(para)}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 0.5em 1em;
      }
    </style>
</head>
<body>
${paragraphs}
</body>
</html>`;
}

export function handleWebviewPanelOpenMessages(
  panel: HostWebviewPanel
): Disposable {
  return panel.webview.onDidReceiveMessage(
    async (e: { type: string; url: string; [key: string]: unknown }) => {
      switch (e.type) {
        case "openExternal":
          try {
            const url = Uri.parse(e.url);
            // These messages originate from untrusted webview content (rendered
            // eval logs / scan results, or injected script). Only hand web URLs
            // to env.openExternal; refusing other schemes prevents a malicious
            // log from launching arbitrary protocol/URI handlers on the host.
            if (kOpenExternalSchemes.includes(url.scheme.toLowerCase())) {
              await env.openExternal(url);
            }
          } catch {
            // Noop
          }
          break;
        case "openWorkspaceFile":
          {
            if (e.url) {
              const file = workspacePath(e.url);
              // Despite the name, workspacePath returns absolute inputs verbatim,
              // so confine the target to an open workspace folder before opening
              // it — otherwise the webview could open any file on disk.
              if (!isWithinWorkspace(file.path)) {
                break;
              }
              try {
                await window.showTextDocument(Uri.file(file.path));
              } catch (err) {
                if (err instanceof Error && err.name === "CodeExpectedError") {
                  const close: MessageItem = { title: "Close" };
                  await window.showInformationMessage<MessageItem>(
                    "This file is too large to be opened by the viewer.",
                    close
                  );
                } else {
                  throw err;
                }
              }
            }
          }
          break;
      }
    }
  );
}
