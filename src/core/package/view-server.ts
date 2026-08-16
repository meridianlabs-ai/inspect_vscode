import { ChildProcess, SpawnOptions } from "child_process";
import { randomUUID } from "crypto";
import * as os from "os";

import AsyncLock from "async-lock";
import { Disposable, ExtensionContext, OutputChannel, window } from "vscode";

import { AbsolutePath, activeWorkspacePath } from "../../core/path";
import { findOpenPort } from "../../core/port";
import { spawnProcess } from "../../core/process";
import { shQuote } from "../../core/string";
import { ViewPathScope, viewPathScopeLocation } from "../../core/uri";

import { PackageManager } from "./manager";

export const kViewScopeHeader = "X-Inspect-View-Scope";
export const kViewScopeKindHeader = "X-Inspect-View-Scope-Kind";

export async function addViewScopeHeaders(
  headers: Headers,
  scope?: ViewPathScope
): Promise<void> {
  if (scope) {
    headers.set(kViewScopeHeader, await viewPathScopeLocation(scope));
    headers.set(kViewScopeKindHeader, scope.kind);
  }
}

// Custom request/response types for JSON-RPC proxy communication.
// We can't use fetch's Request/Response/Headers because:
// - They're not serializable (contain methods, streams, etc.)
// - Headers is a class, not Record<string, string>
// - Response.body is ReadableStream, not string
// - We need bodyEncoding to indicate base64 for binary data
//
// Limitations vs native fetch:
// - No streaming: bodies must be fully buffered as strings
// - Binary data requires base64 encoding (adds ~33% overhead)
// - Multi-value headers (e.g. Set-Cookie) collapse to single string
// - Large request bodies must fit in memory
export interface HttpProxyRpcRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpProxyRpcResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: "utf8" | "base64";
}

export class PackageViewServer implements Disposable {
  constructor(
    context: ExtensionContext,
    packageManager: PackageManager,
    private startCommand_: string[],
    private defaultPort_: number,
    private packageDisplayName_: string,
    private packageBin_: string,
    private packageBinPath_: () => AbsolutePath | null,
    private viewArgs_: string[],
    private logLevel_: string | undefined
  ) {
    // create output channel for debugging
    this.outputChannel_ = window.createOutputChannel(
      `${this.packageDisplayName_} View`
    );

    // shutdown server when inspect version changes (then we'll launch
    // a new instance w/ the correct version)
    context.subscriptions.push(
      packageManager.onPackageChanged(() => {
        this.shutdown();
      })
    );
  }

  protected viewArgs(): string[] {
    return this.viewArgs_;
  }

  protected async api_json(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    headers?: Record<string, string>,
    handleError?: (status: number) => string | undefined,
    scope?: ViewPathScope
  ): Promise<{ data: string; headers: Headers }> {
    const result = await this.api(
      path,
      method,
      headers,
      false,
      handleError,
      scope
    );
    return {
      data: result.data as string,
      headers: result.headers,
    };
  }

  protected async api_bytes(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    scope?: ViewPathScope
  ): Promise<{ data: Uint8Array; headers: Headers }> {
    const result = await this.api(path, method, {}, true, undefined, scope);
    return {
      data: result.data as Uint8Array,
      headers: result.headers,
    };
  }

  /**
   * Low-level HTTP proxy to backend server. Unlike `api()`, passes through
   * all status codes without throwing. Binary detection based on Content-Type.
   */
  protected async serverFetch(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    headers: Headers,
    body?: string,
    scope?: ViewPathScope
  ): Promise<{
    status: number;
    data: string | Uint8Array;
    headers: Headers;
  }> {
    await this.ensureRunning();

    const requestHeaders = new Headers(headers);
    requestHeaders.set("Authorization", this.serverAuthToken_);
    requestHeaders.set("Pragma", "no-cache");
    requestHeaders.set("Expires", "0");
    requestHeaders.set("Cache-Control", "no-cache");
    await addViewScopeHeaders(requestHeaders, scope);

    const response = await fetch(
      `http://localhost:${this.serverPort_}${path}`,
      { method, headers: requestHeaders, body }
    );
    const { status, headers: responseHeaders } = response;

    // Treat anything that isn't JSON or text/* as binary. Decoding raw bytes
    // via response.text() corrupts non-UTF-8 sequences (e.g. zstd-compressed
    // payloads served as application/octet-stream).
    const contentType = responseHeaders.get("Content-Type") ?? "";
    const isText =
      contentType === "" ||
      contentType.includes("application/json") ||
      contentType.startsWith("text/");

    return {
      status,
      data: isText
        ? await response.text()
        : new Uint8Array(await response.arrayBuffer()),
      headers: responseHeaders,
    };
  }

  /**
   * JSON-RPC handler that proxies a webview HTTP request to the backend view
   * server. Used by both the Inspect and Scout webviews so new viewer
   * endpoints need no extension changes.
   */
  public async proxyRpcRequest(
    request: HttpProxyRpcRequest,
    scope?: ViewPathScope
  ): Promise<HttpProxyRpcResponse> {
    await this.ensureRunning();

    const { status, headers, data } = await this.serverFetch(
      request.path,
      request.method,
      new Headers(request.headers),
      request.body,
      scope
    );

    const responseHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status,
      headers: responseHeaders,
      ...(data instanceof Uint8Array
        ? { body: Buffer.from(data).toString("base64"), bodyEncoding: "base64" }
        : { body: data, bodyEncoding: "utf8" }),
    };
  }

  protected async api(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    headers: Record<string, string> = {},
    binary: boolean = false,
    handleError?: (status: number) => string | undefined,
    scope?: ViewPathScope
  ): Promise<{ data: string | Uint8Array; headers: Headers }> {
    // ensure the server is started and ready
    await this.ensureRunning();

    // build headers
    headers = {
      ...headers,
      Authorization: this.serverAuthToken_,
      Accept: binary ? "application/octet-stream" : "application/json",
      Pragma: "no-cache",
      Expires: "0",
      ["Cache-Control"]: "no-cache",
    };
    if (scope) {
      headers[kViewScopeHeader] = await viewPathScopeLocation(scope);
      headers[kViewScopeKindHeader] = scope.kind;
    }

    // make request
    const response = await fetch(
      `http://localhost:${this.serverPort_}${path}`,
      { method: method, headers }
    );
    if (response.ok) {
      if (binary) {
        const buffer = await response.arrayBuffer();
        return { data: new Uint8Array(buffer), headers: response.headers };
      } else {
        const result = await response.text();
        return { data: result, headers: response.headers };
      }
    } else if (response.status !== 200) {
      if (handleError) {
        const error_response = handleError(response.status);
        if (error_response) {
          return { data: error_response, headers: response.headers };
        }
      }
      const message = (await response.text()) || response.statusText;
      const error = new Error(`Error: ${response.status}: ${message})`);
      throw error;
    } else {
      throw new Error(`${response.status} - ${response.statusText} `);
    }
  }

  protected async ensureRunning(): Promise<void> {
    await this.serverStartupLock_.acquire(
      `${this.packageBin_}-server-startup`,
      async () => {
        if (
          this.serverProcess_ === undefined ||
          this.serverProcess_.exitCode !== null
        ) {
          // find port and establish auth token
          this.serverProcess_ = undefined;
          this.serverPort_ = await findOpenPort(this.defaultPort_);
          this.serverAuthToken_ = randomUUID();

          // launch server and wait to resolve/return until it produces output
          return new Promise((resolve, reject) => {
            // find inspect
            const inspect = this.packageBinPath_();
            if (!inspect) {
              throw new Error(
                `${this.packageBin_} view: package installation not found`
              );
            }

            // launch process
            const options: SpawnOptions = {
              cwd: activeWorkspacePath().path,
              env: {
                ...process.env,
                COLUMNS: "150",
                INSPECT_VIEW_AUTHORIZATION_TOKEN: this.serverAuthToken_,
              },
              windowsHide: true,
            };

            // forward output to channel and resolve promise
            let resolved = false;
            const onOutput = (output: string) => {
              this.outputChannel_.append(output);
              if (!resolved) {
                if (output.includes("Running on ")) {
                  resolved = true;
                  resolve(undefined);
                }
              }
            };

            // run server
            const quote =
              os.platform() === "win32" ? shQuote : (arg: string) => arg;
            const args = [
              ...this.startCommand_,
              "--port",
              String(this.serverPort_),
              ...(this.logLevel_ ? ["--log-level", this.logLevel_] : []),
            ].concat(this.viewArgs());
            this.serverProcess_ = spawnProcess(
              quote(inspect.path),
              args.map(quote),
              options,
              {
                stdout: onOutput,
                stderr: onOutput,
              },
              {
                onClose: (code: number) => {
                  this.outputChannel_.appendLine(
                    `${this.packageBin_} view exited with code ${code} (pid=${this.serverProcess_?.pid})`
                  );
                },
                onError: (error: Error) => {
                  this.outputChannel_.appendLine(
                    `Error starting ${this.packageBin_} view ${error.message}`
                  );
                  reject(error);
                },
              }
            );
            this.outputChannel_.appendLine(
              `Starting ${this.packageBin_} view on port ${this.serverPort_} (pid=${this.serverProcess_?.pid})`
            );
          });
        }
      }
    );
  }

  private shutdown() {
    this.serverProcess_?.kill();
    this.serverProcess_ = undefined;
    this.serverPort_ = undefined;
    this.serverAuthToken_ = "";
  }

  dispose() {
    this.shutdown();
    this.outputChannel_.dispose();
  }

  private outputChannel_: OutputChannel;
  private serverStartupLock_ = new AsyncLock();
  private serverProcess_?: ChildProcess = undefined;
  private serverPort_?: number = undefined;
  private serverAuthToken_: string = "";
}
