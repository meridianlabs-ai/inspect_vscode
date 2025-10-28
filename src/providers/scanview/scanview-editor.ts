/* eslint-disable @typescript-eslint/no-unused-vars */
import * as vscode from "vscode";
import { Uri } from "vscode";
import { HostWebviewPanel } from "../../hooks";
import { dirname } from "../../core/uri";
import { ScoutViewServer } from "../scout/scout-view-server";
import { ScanviewPanel } from "./scanview-panel";
import { ScanviewState } from "./scanview-state";
import { scoutViewPath } from "../../scout/props";

export const kScoutScanViewType = "inspect-ai.scout-scan-editor";

class ScoutScanReadonlyEditor implements vscode.CustomReadonlyEditorProvider {
  static register(
    context: vscode.ExtensionContext,
    server: ScoutViewServer
  ): vscode.Disposable {
    const provider = new ScoutScanReadonlyEditor(context, server);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      kScoutScanViewType,
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
    private readonly server_: ScoutViewServer
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    // Parse any params from the Uri
    const queryParams = new URLSearchParams(uri.query);
    const scanner = queryParams.get("scanner");
    const transcript_id = queryParams.get("transcript_id");

    // Return the document with additional info attached to payload
    return {
      uri: uri,
      dispose: () => {},
      scanner: scanner,
      transcript_id: transcript_id,
    } as vscode.CustomDocument & { scanner?: string; transcript_id?: string };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const doc = document as vscode.CustomDocument & {
      scanner?: string;
      transcript_id?: string;
    };
    const scanner = doc.scanner;
    const transcript_id = doc.transcript_id;

    const docUriNoParams = document.uri.with({ query: "", fragment: "" });

    // local resource roots
    const localResourceRoots: Uri[] = [];
    const viewDir = scoutViewPath();
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
    this.scanviewPanel_ = new ScanviewPanel(
      webviewPanel as HostWebviewPanel,
      this.context_,
      this.server_,
      "scan",
      docUriNoParams
    );

    // set html
    const logViewState: ScanviewState = {
      scan_dir: docUriNoParams,
      results_dir: dirname(docUriNoParams),
      scan:
        scanner && transcript_id
          ? {
              scanner: scanner,
              transcript_id: transcript_id,
            }
          : undefined,
    };
    webviewPanel.webview.html = this.scanviewPanel_.getHtml(logViewState);
  }

  dispose() {
    this.scanviewPanel_?.dispose();
  }

  private scanviewPanel_?: ScanviewPanel;
}

export function activateScanviewEditor(
  context: vscode.ExtensionContext,
  server: ScoutViewServer
) {
  context.subscriptions.push(ScoutScanReadonlyEditor.register(context, server));
}
