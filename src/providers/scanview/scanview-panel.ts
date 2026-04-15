import vscode, { ExtensionContext, Uri } from "vscode";

import { Disposable } from "../../core/dispose";
import {
  kMethodGetScan,
  kMethodGetScannerDataframe,
  kMethodGetScannerDataframeInput,
  kMethodGetScans,
  kMethodHttpRequest,
  webviewPanelJsonRpcServer,
} from "../../core/jsonrpc";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
} from "../../core/webview";
import { HostWebviewPanel } from "../../hooks";
import { scoutViewPath } from "../../scout/props";
import {
  HttpProxyRpcRequest,
  ScoutViewServer,
} from "../scout/scout-view-server";

import { RouteMessage } from "./scanview-message";

export class ScanviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    private server_: ScoutViewServer
  ) {
    super();

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      [kMethodGetScans]: async () => server_.legacy.getScans(),
      [kMethodGetScan]: async (params: unknown[]) =>
        server_.legacy.getScan(params[0] as string),
      [kMethodGetScannerDataframe]: async (params: unknown[]) =>
        server_.legacy.getScannerDataframe(
          params[0] as string,
          params[1] as string
        ),
      [kMethodGetScannerDataframeInput]: async (params: unknown[]) =>
        server_.legacy.getScannerDataframeInput(
          params[0] as string,
          params[1] as string,
          params[2] as string
        ),
      [kMethodHttpRequest]: async (params: unknown[]) =>
        server_.proxyRpcRequest(params[0] as HttpProxyRpcRequest),
    });

    // serve post message api to webview
    this._pmUnsubcribe = handleWebviewPanelOpenMessages(panel_);
  }

  public override dispose() {
    this._rpcDisconnect();
    this._pmUnsubcribe.dispose();
  }

  public async getHtml(message: RouteMessage): Promise<string> {
    const stateScript = `<script id="scanview-state" type="application/json">${JSON.stringify(
      message
    )}</script>`;

    // Try to resolve the dist path from the server (handles LFS resolution),
    // falling back to the local scoutViewPath() if the endpoint isn't available.
    const distDir = await this.server_.getDistPath();
    const viewDir = distDir ?? scoutViewPath();

    // Update localResourceRoots to include the resolved dist path,
    // which may differ from the initially registered scoutViewPath().
    if (viewDir) {
      const existingRoots =
        this.panel_.webview.options.localResourceRoots ?? [];
      const distUri = Uri.file(viewDir.path);
      if (!existingRoots.some((r) => r.toString() === distUri.toString())) {
        this.panel_.webview.options = {
          ...this.panel_.webview.options,
          localResourceRoots: [...existingRoots, distUri],
        };
      }
    }

    return getWebviewPanelHtml(
      viewDir,
      this.panel_,
      this.getExtensionVersion(),
      null,
      stateScript,
      "Inspect Scout"
    );
  }

  protected getExtensionVersion(): string {
    return (this.context_.extension.packageJSON as Record<string, unknown>)
      .version as string;
  }

  private _rpcDisconnect: VoidFunction;
  private _pmUnsubcribe: vscode.Disposable;
}
