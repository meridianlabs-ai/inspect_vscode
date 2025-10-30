import vscode from "vscode";
import { ExtensionContext, Uri } from "vscode";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { Disposable } from "../../core/dispose";
import {
  kMethodEvalLog,
  kMethodEvalLogBytes,
  kMethodEvalLogDir,
  kMethodEvalLogFiles,
  kMethodEvalLogHeaders,
  kMethodEvalLogs,
  kMethodEvalLogSize,
  kMethodLogMessage,
  kMethodPendingSamples,
  kMethodSampleData,
  webviewPanelJsonRpcServer,
} from "../../core/jsonrpc";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { LogviewState } from "./logview-state";
import { log } from "../../core/log";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
} from "../../core/webview";

export class LogviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    server: InspectViewServer,
    type: "file" | "dir",
    uri: Uri
  ) {
    super();

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      [kMethodEvalLogDir]: async () => server.evalLogDir(),
      [kMethodEvalLogFiles]: async (params: unknown[]) =>
        server.evalLogFiles(params[0] as number, params[1] as number),
      [kMethodEvalLogs]: async () =>
        type === "dir" ? server.evalLogs(uri) : server.evalLogsSolo(uri),
      [kMethodEvalLog]: (params: unknown[]) =>
        server.evalLog(params[0] as string, params[1] as number | boolean),
      [kMethodEvalLogSize]: (params: unknown[]) =>
        server.evalLogSize(params[0] as string),
      [kMethodEvalLogBytes]: (params: unknown[]) =>
        server.evalLogBytes(
          params[0] as string,
          params[1] as number,
          params[2] as number
        ),
      [kMethodEvalLogHeaders]: (params: unknown[]) =>
        server.evalLogHeaders(params[0] as string[]),
      [kMethodPendingSamples]: (params: unknown[]) =>
        server.evalLogPendingSamples(
          params[0] as string,
          params[1] as string | undefined
        ),
      [kMethodSampleData]: (params: unknown[]) =>
        server.evalLogSampleData(
          params[0] as string,
          params[1] as string | number,
          params[2] as number,
          params[3] as number | undefined,
          params[4] as number | undefined
        ),
      [kMethodLogMessage]: async (params: unknown[]) => {
        const log_file = params[0] as string;
        const message = params[1] as string | undefined;
        log.info(`[CLIENT LOG] (${log_file}): ${message}`);
        await server.logMessage(log_file, message);
      },
    });

    // serve post message api to webview
    this._pmUnsubcribe = handleWebviewPanelOpenMessages(panel_);
  }

  public override dispose() {
    this._rpcDisconnect();
    this._pmUnsubcribe.dispose();
  }

  public getHtml(state: LogviewState): string {
    // get override css path (used for older unbundled version of view)
    const overrideCssPath = this.extensionResourceUrl([
      "assets",
      "www",
      "view",
      "view-overrides.css",
    ]);

    // If there is a log file selected in state, embed the startup message
    // within the view itself. This will allow the log to be set immediately
    // which avoids timing issues when first opening the view (e.g. the updateState
    // message being sent before the view itself is configured to receive messages)
    const stateMsg = {
      type: "updateState",
      url: state.log_file?.toString(),
      sample_id: state.sample?.id,
      sample_epoch: state.sample?.epoch,
    };
    const stateScript = state.log_file
      ? `<script id="logview-state" type="application/json">${JSON.stringify(
          stateMsg
        )}</script>`
      : "";

    return getWebviewPanelHtml(
      inspectViewPath(),
      this.panel_,
      this.getExtensionVersion(),
      overrideCssPath,
      stateScript
    );
  }

  protected getExtensionVersion(): string {
    return (this.context_.extension.packageJSON as Record<string, unknown>)
      .version as string;
  }

  private extensionResourceUrl(parts: string[]): Uri {
    return this.panel_.webview.asWebviewUri(
      Uri.joinPath(this.context_.extensionUri, ...parts)
    );
  }

  private _rpcDisconnect: VoidFunction;
  private _pmUnsubcribe: vscode.Disposable;
}
