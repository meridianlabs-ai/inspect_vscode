import { readFileSync } from "fs";
import { env, Disposable, MessageItem, Uri, window } from "vscode";

import { HostWebviewPanel } from "../hooks";
import { AbsolutePath, workspacePath } from "./path";
import { getNonce } from "./nonce";

export function getWebviewPanelHtml(
  viewDir: AbsolutePath | null,
  panel: HostWebviewPanel,
  extensionVersion: string,
  unbundledCssOverride: Uri | null = null,
  extraHead: string = ""
): string {
  // read the index.html from the log view directory
  if (viewDir) {
    // get nonce
    const nonce = getNonce();

    // file uri for view dir
    const viewDirUri = Uri.file(viewDir.path);

    // get base html
    let indexHtml = readFileSync(viewDir.child("index.html").path, "utf-8");

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
    } blob:; script-src 'nonce-${nonce}' 'unsafe-eval'; connect-src ${
      panel.webview.cspSource
    } blob:;">
    ${overrideCssHtml}
    ${extraHead}

    `
    );

    // function to resolve resource uri
    const resourceUri = (path: string) =>
      panel.webview.asWebviewUri(Uri.joinPath(viewDirUri, path)).toString();

    // nonces for scripts
    indexHtml = indexHtml.replace(
      /<script([ >])/g,
      `<script nonce="${nonce}"$1`
    );

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
    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
</head>
<body>
Not available.
</body>
</html>
`;
  }
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
            await env.openExternal(url);
          } catch {
            // Noop
          }
          break;
        case "openWorkspaceFile":
          {
            if (e.url) {
              const file = workspacePath(e.url);
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
