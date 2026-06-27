import vscode, { ExtensionContext, Uri } from "vscode";

import { Disposable } from "../../core/dispose";
import {
  kMethodAppConfig,
  kMethodEditLog,
  kMethodEvalLog,
  kMethodEvalLogBytes,
  kMethodEvalLogDir,
  kMethodEvalLogFiles,
  kMethodEvalLogHeaders,
  kMethodEvalLogs,
  kMethodEvalLogSize,
  kMethodGetSearchResult,
  kMethodGetUserInfo,
  kMethodHttpRequest,
  kMethodListSearches,
  kMethodLogMessage,
  kMethodPendingSamples,
  kMethodPostSearch,
  kMethodSampleData,
  webviewPanelJsonRpcServer,
} from "../../core/jsonrpc";
import { log } from "../../core/log";
import { HttpProxyRpcRequest } from "../../core/package/view-server";
import {
  pathIsInViewScope,
  resolvePathInViewScope,
  ViewPathScope,
  viewPathScopeLocation,
} from "../../core/uri";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
} from "../../core/webview";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { InspectViewServer } from "../inspect/inspect-view-server";

import { LogviewState } from "./logview-state";

export function logviewHostCapabilities(
  supportsScopedHttpProxy: boolean
): string[] {
  return supportsScopedHttpProxy ? [kMethodHttpRequest] : [];
}

export class LogviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    private server_: InspectViewServer,
    private readonly scope_: ViewPathScope
  ) {
    super();
    this.supportsScopedHttpProxy_ = server_.supportsScopedHttpProxy();
    const type = scope_.kind === "directory" ? "dir" : "file";
    const uri = scope_.uri;

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      [kMethodEvalLogDir]: () => {
        if (type === "dir") {
          return Promise.resolve(JSON.stringify({ log_dir: uri.toString() }));
        }
        return Promise.resolve(JSON.stringify({ log_dir: "" }));
      },
      [kMethodEvalLogFiles]: async (params: unknown[]) =>
        type === "dir"
          ? server_.evalLogFiles(
              uri.toString(),
              params[0] as number,
              params[1] as number,
              this.scope_
            )
          : Promise.resolve(undefined),
      [kMethodEvalLogs]: async () =>
        type === "dir"
          ? server_.evalLogs(uri, this.scope_)
          : server_.evalLogsSolo(uri, this.scope_),
      [kMethodEvalLog]: (params: unknown[]) =>
        server_.evalLog(
          params[0] as string,
          params[1] as number | boolean,
          this.scope_
        ),
      [kMethodEvalLogSize]: (params: unknown[]) =>
        server_.evalLogSize(params[0] as string, this.scope_),
      [kMethodEvalLogBytes]: (params: unknown[]) =>
        server_.evalLogBytes(
          params[0] as string,
          params[1] as number,
          params[2] as number,
          this.scope_
        ),
      [kMethodEvalLogHeaders]: (params: unknown[]) =>
        server_.evalLogHeaders(params[0] as string[], this.scope_),
      [kMethodPendingSamples]: (params: unknown[]) =>
        server_.evalLogPendingSamples(
          params[0] as string,
          params[1] as string | undefined,
          this.scope_
        ),
      [kMethodSampleData]: (params: unknown[]) =>
        server_.evalLogSampleData(
          params[0] as string,
          params[1] as string | number,
          params[2] as number,
          this.scope_,
          params[3] as number | undefined,
          params[4] as number | undefined
        ),
      [kMethodLogMessage]: async (params: unknown[]) => {
        const log_file = params[0] as string;
        const message = params[1] as string | undefined;
        log.info(`[CLIENT LOG] (${log_file}): ${message}`);
        await server_.logMessage(log_file, message, this.scope_);
      },
      [kMethodEditLog]: (params: unknown[]) =>
        server_.editLog(
          params[0] as string,
          params[1],
          params[2] as string | undefined,
          this.scope_
        ),
      [kMethodGetUserInfo]: () => server_.getUserInfo(),
      [kMethodAppConfig]: () => server_.getAppConfig(),
      [kMethodListSearches]: (params: unknown[]) =>
        server_.listSearches(params[0] as string, params[1] as number),
      [kMethodPostSearch]: (params: unknown[]) =>
        server_.postSearch(
          params[0] as string,
          params[1] as string,
          params[2],
          this.scope_
        ),
      [kMethodGetSearchResult]: (params: unknown[]) =>
        server_.getSearchResult(
          params[0] as string,
          params[1] as string,
          params[2] as string,
          params[3] as { events?: string; messages?: string } | undefined,
          this.scope_
        ),
      ...(this.supportsScopedHttpProxy_
        ? {
            [kMethodHttpRequest]: async (params: unknown[]) =>
              server_.proxyRpcRequest(
                params[0] as HttpProxyRpcRequest,
                this.scope_
              ),
          }
        : {}),
    });

    // serve post message api to webview
    this._pmUnsubcribe = handleWebviewPanelOpenMessages(panel_);
  }

  public override dispose() {
    this._rpcDisconnect();
    this._pmUnsubcribe.dispose();
  }

  public scope(): ViewPathScope {
    return this.scope_;
  }

  public allows(location: string | Uri): Promise<boolean> {
    return pathIsInViewScope(this.scope_, location);
  }

  public async resolve(location: string | Uri): Promise<Uri | null> {
    return await resolvePathInViewScope(this.scope_, location);
  }

  public async getHtml(state: LogviewState): Promise<string> {
    await this.scope_.canonicalUri;

    // Try to resolve the dist path from the server (handles LFS resolution),
    // falling back to the local scoutViewPath() if the endpoint isn't available.
    const distDir = await this.server_.getDistPath();
    const viewDir = distDir ?? inspectViewPath();

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
      url: state.log_file
        ? await viewPathScopeLocation(this.scope_)
        : undefined,
      sample_id: state.sample?.id,
      sample_epoch: state.sample?.epoch,
    };
    const stateScript = state.log_file
      ? `<script id="logview-state" type="application/json">${JSON.stringify(
          stateMsg
        )}</script>`
      : "";

    // Advertise the generic proxy only when the backend enforces path scopes.
    const hostCapabilities = logviewHostCapabilities(
      this.supportsScopedHttpProxy_
    );
    const capabilitiesScript = `<script id="inspect-host-capabilities" type="application/json">${JSON.stringify(
      hostCapabilities
    )}</script>`;

    return getWebviewPanelHtml(
      viewDir,
      this.panel_,
      this.getExtensionVersion(),
      overrideCssPath,
      stateScript + capabilitiesScript,
      "Inspect AI"
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
  private readonly supportsScopedHttpProxy_: boolean;
}
