import { readFileSync } from "fs";

import { Disposable, env, MessageItem, Uri, window, workspace } from "vscode";

import { HostWebviewPanel } from "../hooks";

import { getNonce } from "./nonce";
import { AbsolutePath, workspacePath } from "./path";
import { getRelativeUri } from "./uri";
import { getMessagePanelHtml, renderWebviewHtml } from "./webview-render";

export { getMessagePanelHtml, jsonForScript } from "./webview-render";

// Schemes the webview is allowed to open via env.openExternal. Web links only;
// vscode://, file://, and OS-registered custom schemes are refused.
const kOpenExternalSchemes = ["http", "https", "mailto"];

// Whether an absolute path resolves inside one of the open workspace folders.
function isWithinWorkspace(absPath: string): boolean {
  const target = Uri.file(absPath);
  return (workspace.workspaceFolders ?? []).some(
    (folder) =>
      folder.uri.fsPath === absPath ||
      getRelativeUri(folder.uri, target) !== null
  );
}

/**
 * Render a viewer dist's `index.html` for a webview panel. The transform lives
 * in `renderWebviewHtml` (./webview-render); this supplies the panel's
 * `cspSource`, a fresh nonce and webview resource URIs.
 */
export function getWebviewPanelHtml(
  viewDir: AbsolutePath | null,
  panel: HostWebviewPanel,
  extensionVersion: string,
  unbundledCssOverride: Uri | null = null,
  extraHead: string = "",
  packageName: string = "the package"
): string {
  if (!viewDir) {
    return getMessagePanelHtml(
      `${packageName} view is not available.\n\nEnsure that the required Python package is installed in the active Python interpreter (or select a Python interpreter that includes it), then try again.`
    );
  }

  const viewDirUri = Uri.file(viewDir.path);
  return renderWebviewHtml({
    indexHtml: readFileSync(viewDir.child("index.html").path, "utf-8"),
    cspSource: panel.webview.cspSource,
    nonce: getNonce(),
    resourceUri: (path: string) =>
      panel.webview.asWebviewUri(Uri.joinPath(viewDirUri, path)).toString(),
    extensionVersion,
    unbundledCssOverride: unbundledCssOverride?.toString() ?? null,
    extraHead,
    packageName,
  });
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
