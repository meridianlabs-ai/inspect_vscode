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
import { AbsolutePath } from "../../core/path";
import { getRelativeUri, resolveToUri } from "../../core/uri";
import {
  getWebviewPanelHtml,
  handleWebviewPanelOpenMessages,
  jsonForScript,
} from "../../core/webview";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { InspectViewServer } from "../inspect/inspect-view-server";

import { LogviewState } from "./logview-state";

/**
 * Whether a webview-supplied file path/URL is within the scope this log-view
 * panel was opened for. A `file` panel may only touch its own log file; a `dir`
 * panel may only touch descendants of its log directory. Used to gate the
 * file-content RPC methods so injected webview script cannot read or write
 * paths outside what the panel is actually viewing.
 */
export function logPathInScope(
  type: "file" | "dir",
  panelUri: Uri,
  target: string
): boolean {
  const panelUriStr = panelUri.toString();
  let targetUri: Uri;
  try {
    targetUri = resolveToUri(target);
  } catch {
    return false;
  }
  if (target === panelUriStr || targetUri.toString() === panelUriStr) {
    return true;
  }
  return type === "dir" && getRelativeUri(panelUri, targetUri) !== null;
}

// jsonForScript now lives in core/webview.ts (shared with the scan view). It
// is re-exported here so existing importers/tests keep working.
export { jsonForScript };

export class LogviewPanel extends Disposable {
  constructor(
    private panel_: HostWebviewPanel,
    private context_: ExtensionContext,
    private server_: InspectViewServer,
    type: "file" | "dir",
    uri: Uri
  ) {
    super();

    // The webview renders untrusted eval-log content and its RPC surface is
    // reachable from injected script. The token-authorized view server reads
    // and writes ANY path/URL by design, so the extension host is the only
    // place that can confine webview-supplied paths to what this panel is
    // actually viewing. Every file-content method below is gated by this guard:
    // a `file` panel may only touch its own log file; a `dir` panel may only
    // touch descendants of its log directory. Requests outside that scope are
    // rejected before the path ever reaches the server.
    const requireScope = (target: unknown): string => {
      if (typeof target !== "string" || !logPathInScope(type, uri, target)) {
        throw new Error(
          `Refusing to access "${String(
            target
          )}": outside the scope of this log view.`
        );
      }
      return target;
    };

    // serve eval log api to webview
    this._rpcDisconnect = webviewPanelJsonRpcServer(panel_, {
      [kMethodEvalLogDir]: async () => {
        if (type === "dir") {
          return JSON.stringify({ log_dir: uri.toString() });
        }
        const result = await server_.evalLogDir();
        return result;
      },
      [kMethodEvalLogFiles]: async (params: unknown[]) =>
        type === "dir"
          ? server_.evalLogFiles(
              uri.toString(),
              params[0] as number,
              params[1] as number
            )
          : Promise.resolve(undefined),
      [kMethodEvalLogs]: async () =>
        type === "dir" ? server_.evalLogs(uri) : server_.evalLogsSolo(uri),
      [kMethodEvalLog]: (params: unknown[]) =>
        server_.evalLog(requireScope(params[0]), params[1] as number | boolean),
      [kMethodEvalLogSize]: (params: unknown[]) =>
        server_.evalLogSize(requireScope(params[0])),
      [kMethodEvalLogBytes]: (params: unknown[]) =>
        server_.evalLogBytes(
          requireScope(params[0]),
          params[1] as number,
          params[2] as number
        ),
      [kMethodEvalLogHeaders]: (params: unknown[]) =>
        server_.evalLogHeaders(
          (params[0] as unknown[]).map((f) => requireScope(f))
        ),
      [kMethodPendingSamples]: (params: unknown[]) =>
        server_.evalLogPendingSamples(
          requireScope(params[0]),
          params[1] as string | undefined
        ),
      [kMethodSampleData]: (params: unknown[]) =>
        server_.evalLogSampleData(
          requireScope(params[0]),
          params[1] as string | number,
          params[2] as number,
          params[3] as number | undefined,
          params[4] as number | undefined
        ),
      [kMethodLogMessage]: async (params: unknown[]) => {
        const log_file = requireScope(params[0]);
        const message = params[1] as string | undefined;
        log.info(`[CLIENT LOG] (${log_file}): ${message}`);
        await server_.logMessage(log_file, message);
      },
      [kMethodEditLog]: (params: unknown[]) =>
        server_.editLog(
          requireScope(params[0]),
          params[1],
          params[2] as string | undefined
        ),
      [kMethodGetUserInfo]: () => server_.getUserInfo(),
      [kMethodAppConfig]: () => server_.getAppConfig(),
      // The transcript-search methods carry a webview-supplied transcript
      // directory; confine it to the panel scope like every file-content method,
      // so injected script can't search/read transcripts outside the viewed log.
      [kMethodListSearches]: (params: unknown[]) =>
        server_.listSearches(requireScope(params[0]), params[1] as number),
      [kMethodPostSearch]: (params: unknown[]) =>
        server_.postSearch(
          requireScope(params[0]),
          params[1] as string,
          params[2]
        ),
      [kMethodGetSearchResult]: (params: unknown[]) =>
        server_.getSearchResult(
          requireScope(params[0]),
          params[1] as string,
          params[2] as string,
          params[3] as { events?: string; messages?: string } | undefined
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

  public async getHtml(state: LogviewState): Promise<string> {
    // Try to resolve the dist path from the server (handles LFS resolution),
    // falling back to the local inspectViewPath() if the endpoint isn't
    // available. If the server can't run at all (e.g. inspect_ai isn't
    // installed) fall back as well so we render the 'not available' message
    // rather than leaving the panel blank.
    let distDir: AbsolutePath | null = null;
    try {
      distDir = await this.server_.getDistPath();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.info(`Unable to resolve view dist path from view server: ${message}`);
    }
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
      url: state.log_file?.toString(),
      sample_id: state.sample?.id,
      sample_epoch: state.sample?.epoch,
    };
    const stateScript = state.log_file
      ? `<script id="logview-state" type="application/json">${jsonForScript(
          stateMsg
        )}</script>`
      : "";

    // Advertise the generic http_request proxy to the viewer. Older extensions
    // inject nothing, so the viewer falls back to the named-RPC API.
    const capabilitiesScript = `<script id="inspect-host-capabilities" type="application/json">${jsonForScript(
      [kMethodHttpRequest]
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
}
