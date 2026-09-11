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
import { parseProxyRequest } from "../../core/package/proxy-request";
import {
  assertLogProxyInScope,
  bindLogProxyDefaultLocation,
} from "../../core/package/proxy-scope";
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
 * Whether a file path/URL, taken literally, is within the scope this log-view
 * panel was opened for. A `file` panel may only touch its own log file; a `dir`
 * panel may only touch descendants of its log directory.
 *
 * This is the raw containment check. Webview-supplied locations must go
 * through {@link logPathInScopeAllowingEncoded} instead, because the view
 * server percent-decodes every location it receives before opening it.
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

/**
 * Scope check for a webview-supplied location, judged the way the view server
 * will interpret it. The server percent-decodes every location once more
 * after the route's own URL decoding (`normalize_uri` on the `{log:path}`
 * routes and `/api/log-headers`, `urllib.parse.unquote` on the pending-sample
 * and log-message routes), so `/w/logs/..%2F..%2Fetc%2Fpasswd` is one odd
 * file name to a literal check but `/w/logs/../../etc/passwd` to the server.
 * The plain {@link logPathInScope} runs a scheme-less value through
 * `Uri.file`, which keeps `%XX` literal, so it would accept that traversal and
 * would also reject a legitimate `%20`-encoded path such as the scheme-stripped
 * `transcriptDir` the viewer sends. Validate the decoded form instead: it
 * matches encoded paths and lets getRelativeUri reject the revealed `..`. This
 * is what every path-bearing RPC method and the http_request proxy use; the raw
 * value is still what is forwarded to the server. Malformed percent-encoding
 * (which the server would pass through literally) is refused rather than
 * guessed at.
 */
export function logPathInScopeAllowingEncoded(
  type: "file" | "dir",
  panelUri: Uri,
  target: string
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // malformed percent-encoding
    return false;
  }
  return logPathInScope(type, panelUri, decoded);
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
    // rejected before the path ever reaches the server. The check judges the
    // location as the server will decode it (see logPathInScopeAllowingEncoded)
    // and returns the raw value unchanged, which is what the server is sent.
    const requireScope = (target: unknown): string => {
      if (
        typeof target !== "string" ||
        !logPathInScopeAllowingEncoded(type, uri, target)
      ) {
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
      // list_searches carries only a search type + count (no path), so it needs
      // no scope check. post_search / get_search_result DO carry a
      // webview-supplied transcript directory; confine it to the panel scope
      // like every file-content method so injected script can't search/read
      // transcripts outside the viewed log.
      [kMethodListSearches]: (params: unknown[]) =>
        server_.listSearches(params[0] as string, params[1] as number),
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
      [kMethodHttpRequest]: async (params: unknown[]) => {
        // The generic proxy reaches every view-server endpoint with the auth
        // token, so confine it to the panel scope like the named methods. The
        // server percent-decodes the locations it receives (normalize_uri), so
        // use the encoding-tolerant check to scope the decoded form.
        // Validate the untrusted payload (exact method token, well-formed path,
        // headers and body) before any policy check reads it. A listing that
        // names no directory is bound to this panel's own location first, so
        // the server's default log directory is never listed on the panel's
        // behalf (the scope check refuses a listing that is still bare).
        const request = bindLogProxyDefaultLocation(
          parseProxyRequest(params[0]),
          uri.toString()
        );
        try {
          assertLogProxyInScope(request, (target) =>
            logPathInScopeAllowingEncoded(type, uri, target)
          );
        } catch (error) {
          log.warn(`[proxy-scope] blocked ${request.method} ${request.path}`);
          throw error;
        }
        log.trace(`[proxy-scope] allowed ${request.method} ${request.path}`);
        return server_.proxyRpcRequest(request);
      },
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

    // Update localResourceRoots to include the resolved dist path,
    // which may differ from the initially registered inspectViewPath().
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
