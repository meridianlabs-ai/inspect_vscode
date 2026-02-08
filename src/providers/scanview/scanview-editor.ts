import * as vscode from "vscode";
import { Uri } from "vscode";
import { HostWebviewPanel } from "../../hooks";
import { ScoutViewServer } from "../scout/scout-view-server";
import { ScanviewPanel } from "./scanview-panel";
import { RouteMessage, viewScanRouteMessage } from "./scanview-message";
import { scoutViewPath } from "../../scout/props";
import { basename, dirname } from "../../core/uri";

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
    let scanDir = dirname(document.uri);
    let scanJob = basename(document.uri);
    let scannerName = undefined;

    // If the uri ends with a parquet file, clip it off and use the
    // name of the parquet file as scanner
    if (scanJob.endsWith(".parquet")) {
      scannerName = scanJob.replace(/\.parquet$/, "");
      scanJob = basename(scanDir);
      scanDir = dirname(scanDir);
    }

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
      this.server_
    );

    // set html
    const initialRouteMessage: RouteMessage = viewScanRouteMessage(
      scanDir,
      scanJob,
      scannerName
    );
    webviewPanel.webview.html =
      this.scanviewPanel_.getHtml(initialRouteMessage);
    return Promise.resolve();
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
