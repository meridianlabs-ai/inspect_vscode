import vscode from "vscode";
import { ExtensionContext, Uri } from "vscode";
import { HostWebviewPanel } from "../../hooks";
import { webviewPanelJsonRpcServer } from "../../core/jsonrpc";
import { ScanviewState } from "./scanview-state";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
} from "../../core/webview";
import { ScoutViewServer } from "../scout/scout-view-server";
import { scoutViewPath } from "../../scout/props";
import { Disposable } from "../../core/dispose";

export class ScanviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    _server: ScoutViewServer,
    _type: "scan" | "results",
    _uri: Uri
  ) {
    super();

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      // TODO: methods
    });

    // serve post message api to webview
    this._pmUnsubcribe = handleWebviewPanelOpenMessages(panel_);
  }

  public override dispose() {
    this._rpcDisconnect();
    this._pmUnsubcribe.dispose();
  }

  public getHtml(_state: ScanviewState): string {
    // TODO: turn state into extraHead content
    const extraHead = "";

    return getWebviewPanelHtml(
      scoutViewPath(),
      this.panel_,
      this.getExtensionVersion(),
      null,
      extraHead
    );
  }

  protected getExtensionVersion(): string {
    return (this.context_.extension.packageJSON as Record<string, unknown>)
      .version as string;
  }

  private _rpcDisconnect: VoidFunction;
  private _pmUnsubcribe: vscode.Disposable;
}
