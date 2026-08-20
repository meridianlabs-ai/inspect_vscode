import * as vscode from "vscode";
import { Uri } from "vscode";

import { log } from "../../core/log";
import { dirname } from "../../core/uri";
import { getMessagePanelHtml } from "../../core/webview";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { hasMinimumInspectVersion } from "../../inspect/version";
import { kInspectEvalLogFormatVersion } from "../inspect/inspect-constants";
import { InspectViewServer } from "../inspect/inspect-view-server";

import { LogviewPanel } from "./logview-panel";
import { LogviewState } from "./logview-state";

export const kInspectLogViewType = "inspect-ai.log-editor";

class InspectLogReadonlyEditor implements vscode.CustomReadonlyEditorProvider {
  static register(
    context: vscode.ExtensionContext,
    server: InspectViewServer
  ): vscode.Disposable {
    const provider = new InspectLogReadonlyEditor(context, server);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      kInspectLogViewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: false,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return providerRegistration;
  }

  constructor(
    private readonly context_: vscode.ExtensionContext,
    private readonly server_: InspectViewServer
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    // Parse any params from the Uri
    const queryParams = new URLSearchParams(uri.query);
    const sample_id = queryParams.get("sample_id");
    const epoch = queryParams.get("epoch");

    // Return the document with additional info attached to payload
    return {
      uri: uri,
      dispose: () => {},
      sample_id,
      epoch,
    } as vscode.CustomDocument & { sample_id?: string; epoch?: string };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const doc = document as vscode.CustomDocument & {
      sample_id?: string;
      epoch?: string;
    };
    const sample_id = doc.sample_id;
    const epoch = doc.epoch;

    const docUriNoParams = document.uri.with({ query: "", fragment: "" });
    const docUriStr = docUriNoParams.toString();

    // If inspect_ai is missing (or too old to support the eval log format)
    // we can't render the log, so show an explanatory message in the editor.
    // Falling back to the default editor would show a "binary file" error
    // for .eval files and leave this panel behind as a blank tab.
    if (!hasMinimumInspectVersion(kInspectEvalLogFormatVersion)) {
      log.info(
        `Unable to display log file ${document.uri.path} (inspect-ai >= ${kInspectEvalLogFormatVersion} not found in the active Python interpreter).`
      );
      webviewPanel.webview.options = { enableScripts: false };
      webviewPanel.webview.html = getMessagePanelHtml(
        `Unable to display the log file.\n\nInspect View requires version ${kInspectEvalLogFormatVersion} or later of the inspect-ai package in the active Python interpreter. Install or update inspect-ai (or select a Python interpreter that includes it), then reopen this file.`
      );
      return;
    }

    // JSON logs beyond the size threshold can't be rendered by the viewer,
    // so delegate to the default text editor (which shows its own large file
    // message) and close the webview tab so it isn't left behind blank.
    if (docUriStr.endsWith(".json")) {
      const fileSize = await this.server_.evalLogSize(docUriStr);
      if (fileSize > 1024 * 1000 * 100) {
        log.info(
          `JSON log file ${document.uri.path} is too large for Inspect View, opening in text editor.`
        );
        await vscode.commands.executeCommand(
          "vscode.openWith",
          document.uri,
          "default",
          webviewPanel.viewColumn
        );
        webviewPanel.dispose();
        return;
      }
    }

    // local resource roots
    const localResourceRoots: Uri[] = [];
    const viewDir = inspectViewPath();
    if (viewDir) {
      localResourceRoots.push(Uri.file(viewDir.path));
    }
    Uri.joinPath(this.context_.extensionUri, "assets", "www");

    // set webview options
    webviewPanel.webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots,
    };

    // editor panel implementation
    this.logviewPanel_ = new LogviewPanel(
      webviewPanel as HostWebviewPanel,
      this.context_,
      this.server_,
      "file",
      docUriNoParams
    );

    // set html
    const logViewState: LogviewState = {
      log_file: docUriNoParams,
      log_dir: dirname(docUriNoParams),
      sample:
        sample_id && epoch
          ? {
              id: sample_id,
              epoch: epoch,
            }
          : undefined,
    };
    webviewPanel.webview.html = await this.logviewPanel_.getHtml(logViewState);
  }

  dispose() {
    this.logviewPanel_?.dispose();
  }

  private logviewPanel_?: LogviewPanel;
}

export function activateLogviewEditor(
  context: vscode.ExtensionContext,
  server: InspectViewServer
) {
  context.subscriptions.push(
    InspectLogReadonlyEditor.register(context, server)
  );
}
