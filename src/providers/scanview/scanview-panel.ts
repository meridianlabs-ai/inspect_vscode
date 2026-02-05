import vscode from "vscode";
import { ExtensionContext, Uri } from "vscode";
import { HostWebviewPanel } from "../../hooks";
import {
  kMethodGetScan,
  kMethodGetScannerDataframe,
  kMethodGetScannerDataframeInput,
  kMethodGetScans,
  kMethodHttpRequest,
  webviewPanelJsonRpcServer,
} from "../../core/jsonrpc";
import { ScanviewState } from "./scanview-state";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
} from "../../core/webview";
import {
  HttpProxyRpcRequest,
  ScoutViewServer,
} from "../scout/scout-view-server";
import { scoutViewPath } from "../../scout/props";
import { Disposable } from "../../core/dispose";

export class ScanviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    server: ScoutViewServer,
    _type: "scan" | "results",
    _uri: Uri
  ) {
    super();

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      [kMethodGetScans]: async () => server.legacy.getScans(),
      [kMethodGetScan]: async (params: unknown[]) =>
        server.legacy.getScan(params[0] as string),
      [kMethodGetScannerDataframe]: async (params: unknown[]) =>
        server.legacy.getScannerDataframe(
          params[0] as string,
          params[1] as string
        ),
      [kMethodGetScannerDataframeInput]: async (params: unknown[]) =>
        server.legacy.getScannerDataframeInput(
          params[0] as string,
          params[1] as string,
          params[2] as string
        ),
      [kMethodHttpRequest]: async (params: unknown[]) =>
        server.proxyRpcRequest(params[0] as HttpProxyRpcRequest),
    });

    // serve post message api to webview
    this._pmUnsubcribe = handleWebviewPanelOpenMessages(panel_);
  }

  public override dispose() {
    this._rpcDisconnect();
    this._pmUnsubcribe.dispose();
  }

  public getHtml(state: ScanviewState): string {
    const stateMsg = {
      type: "updateState",
      url: state.scan_dir?.toString(),
      scanner: state.scan?.scanner,
      transcript_id: state.scan?.transcript_id,
      extensionProtocolVersion: 2,
    };
    const stateScript = `<script id="scanview-state" type="application/json">${JSON.stringify(
      stateMsg
    )}</script>`;
    return getWebviewPanelHtml(
      scoutViewPath(),
      this.panel_,
      this.getExtensionVersion(),
      null,
      stateScript
    );
  }

  protected getExtensionVersion(): string {
    return (this.context_.extension.packageJSON as Record<string, unknown>)
      .version as string;
  }

  private _rpcDisconnect: VoidFunction;
  private _pmUnsubcribe: vscode.Disposable;
}
