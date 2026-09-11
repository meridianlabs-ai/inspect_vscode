import { ChildProcess, SpawnOptions } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, realpathSync } from "fs";
import * as os from "os";
import { isAbsolute, join, relative, sep } from "path";

import AsyncLock from "async-lock";
import { Disposable, ExtensionContext, OutputChannel, window } from "vscode";

import {
  AbsolutePath,
  activeWorkspacePath,
  toAbsolutePath,
} from "../../core/path";
import { findOpenPort } from "../../core/port";
import { runProcess, spawnProcess } from "../../core/process";
import { runPython } from "../../core/python/exec";
import { shQuote } from "../../core/string";

import { PackageManager } from "./manager";
import { parseProxyRequest } from "./proxy-request";

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
  method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
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

// Connect to the loopback address by its literal IPv4 form rather than the name
// "localhost". On hosts where "localhost" resolves to ::1 ahead of 127.0.0.1, a
// co-resident user can pre-bind [::1]:<port> (the port probe in port.ts only
// checks 127.0.0.1, and the child binds 127.0.0.1), and every token-bearing
// request to "localhost" would then be delivered to the attacker's socket. Using
// the same literal address the child binds and the probe checks removes that
// name-resolution gap. See CWE-923.
const kServerHost = "127.0.0.1";

interface ServerInstance {
  ready: boolean;
  child?: ChildProcess;
  port?: number;
  token: string;
  controller: AbortController;
  cancelStartup?: (error: Error) => void;
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
    private logLevel_: string | undefined,
    private packageName_: "inspect_ai" | "inspect_scout"
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

  protected async api_json(
    path: string,
    method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" = "GET",
    headers?: Record<string, string>,
    handleError?: (status: number) => string | undefined
  ): Promise<{ data: string; headers: Headers }> {
    const result = await this.api(path, method, headers, false, handleError);
    return {
      data: result.data as string,
      headers: result.headers,
    };
  }

  protected async api_bytes(
    path: string,
    method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" = "GET"
  ): Promise<{ data: Uint8Array; headers: Headers }> {
    const result = await this.api(path, method, {}, true);
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
    method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE",
    headers: Headers,
    body?: string
  ): Promise<{
    status: number;
    data: string | Uint8Array;
    headers: Headers;
  }> {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Pragma", "no-cache");
    requestHeaders.set("Expires", "0");
    requestHeaders.set("Cache-Control", "no-cache");

    return this.request(
      path,
      { method, headers: requestHeaders, body },
      async (response) => {
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
    );
  }

  /**
   * JSON-RPC handler that proxies a webview HTTP request to the backend view
   * server. Used by both the Inspect and Scout webviews. Callers must confine
   * the request to the panel scope first (see `proxy-scope.ts`); a new viewer
   * endpoint therefore needs a matching entry in that route table.
   */
  public async proxyRpcRequest(
    request: HttpProxyRpcRequest
  ): Promise<HttpProxyRpcResponse> {
    request = parseProxyRequest(request);

    const { status, headers, data } = await this.serverFetch(
      request.path,
      request.method,
      new Headers(request.headers),
      request.body
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
    method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" = "GET",
    headers: Record<string, string> = {},
    binary: boolean = false,
    handleError?: (status: number) => string | undefined
  ): Promise<{ data: string | Uint8Array; headers: Headers }> {
    // build headers
    headers = {
      ...headers,
      Accept: binary ? "application/octet-stream" : "application/json",
      Pragma: "no-cache",
      Expires: "0",
      ["Cache-Control"]: "no-cache",
    };

    // make request
    return this.request(path, { method, headers }, async (response) => {
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
    });
  }

  // Keep the process identity through the complete response body read. A response
  // from an instance that stopped or was replaced must never become authority.
  private async request<T>(
    path: string,
    options: RequestInit,
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    // Invalid caller input is not a failed server connection. Construct locally
    // before entering the lifecycle/transport path.
    new Request(`http://${kServerHost}${path}`, options);
    await this.ensureRunning();
    const instance = this.server_;
    if (!instance || !this.isRunning(instance)) {
      throw new Error(`${this.packageBin_} view is not running`);
    }
    const headers = new Headers(options.headers);
    headers.set("Authorization", instance.token);
    let response: Response;
    try {
      response = await fetch(`http://${kServerHost}:${instance.port}${path}`, {
        ...options,
        headers,
        signal: instance.controller.signal,
        redirect: "error",
      });
    } catch (error) {
      this.stop(instance);
      throw error;
    }
    const result = await consume(response);
    if (!this.isRunning(instance)) {
      throw new Error(`${this.packageBin_} view stopped during request`);
    }
    return result;
  }

  private isRunning(instance: ServerInstance): boolean {
    return instance.ready && this.isAlive(instance);
  }

  private isAlive(instance: ServerInstance): boolean {
    return (
      this.server_ === instance &&
      !instance.controller.signal.aborted &&
      instance.child !== undefined &&
      instance.child.exitCode === null &&
      instance.child.signalCode === null &&
      !instance.child.killed
    );
  }

  protected async ensureRunning(): Promise<void> {
    await this.serverStartupLock_.acquire(
      `${this.packageBin_}-server-startup`,
      async () => {
        if (this.disposed_) {
          throw new Error(`${this.packageBin_} view is disposed`);
        }
        if (this.server_ && this.isRunning(this.server_)) {
          return;
        }
        this.shutdown();
        const instance: ServerInstance = {
          ready: false,
          token: randomUUID(),
          controller: new AbortController(),
        };
        this.server_ = instance;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            instance.cancelStartup = undefined;
            if (error) {
              this.stop(instance);
              reject(error);
            } else {
              instance.ready = true;
              resolve();
            }
          };
          instance.cancelStartup = finish;
          const timer = setTimeout(() => {
            const error = new Error(
              `${this.packageBin_} view startup timed out after ${this.startupTimeoutMs_ / 1000} seconds`
            );
            this.outputChannel_.appendLine(error.message);
            finish(error);
          }, this.startupTimeoutMs_);
          const launch = async () => {
            const port = await findOpenPort(this.defaultPort_);
            // Shutdown can happen while probing a port.
            if (instance.controller.signal.aborted) return;
            instance.port = port;
            const binary = this.packageBinPath_();
            if (!binary) {
              throw new Error(
                `${this.packageBin_} view: package installation not found`
              );
            }
            const options: SpawnOptions = {
              cwd: activeWorkspacePath().path,
              env: {
                ...process.env,
                COLUMNS: "150",
                INSPECT_VIEW_AUTHORIZATION_TOKEN: instance.token,
              },
              windowsHide: true,
            };
            // Keep only the possible banner prefix, independently per stream.
            const outputHandler = () => {
              let tail = "";
              return (output: string) => {
                if (instance.controller.signal.aborted) return;
                this.outputChannel_.append(output);
                const text = tail + output;
                if (text.includes("Running on ") && this.isAlive(instance))
                  finish();
                tail = text.slice(-"Running on ".length + 1);
              };
            };
            const ended = (
              code: number | null,
              signal: NodeJS.Signals | null
            ) => {
              if (instance.controller.signal.aborted) return;
              this.outputChannel_.appendLine(
                `${this.packageBin_} view exited with code ${code}, signal ${signal} (pid=${instance.child?.pid})`
              );
              finish(
                new Error(
                  `${this.packageBin_} view exited before readiness (code ${code}, signal ${signal})`
                )
              );
              this.stop(instance);
            };
            const quote =
              os.platform() === "win32" ? shQuote : (arg: string) => arg;
            const args = [
              ...this.startCommand_,
              "--port",
              String(port),
              ...(this.logLevel_ ? ["--log-level", this.logLevel_] : []),
              ...this.viewArgs_,
            ];
            instance.child = spawnProcess(
              quote(binary.path),
              args.map(quote),
              options,
              { stdout: outputHandler(), stderr: outputHandler() },
              {
                onError: (error: Error) => {
                  if (instance.controller.signal.aborted) return;
                  this.outputChannel_.appendLine(
                    `Error starting ${this.packageBin_} view ${error.message}`
                  );
                  finish(error);
                  this.stop(instance);
                },
              }
            );
            // exit may precede close indefinitely when a descendant holds stdio.
            instance.child.once("exit", ended);
            instance.child.once("close", ended);
            this.outputChannel_.appendLine(
              `Starting ${this.packageBin_} view on port ${port} (pid=${instance.child.pid})`
            );
          };
          void launch().catch((error: Error) => finish(error));
        });
      }
    );
  }

  // The CLI is a trusted local source of package identity; the HTTP response is
  // not. Resolve symlinks before allowing a directory (and its entry HTML) to
  // become a webview resource root. Editable installs remain supported.
  protected resourcePath(data: string): AbsolutePath | null {
    const value: unknown = JSON.parse(data);
    if (value === null) return null;
    const candidate = (value as { path?: unknown }).path;
    const binary = this.packageBinPath_();
    if (typeof candidate !== "string" || !isAbsolute(candidate) || !binary) {
      throw new Error("Invalid view resource path");
    }
    // Cache local discovery per binary/package lifetime, not per panel open.
    if (this.resourceRoots_?.binary !== binary.path) {
      const info = JSON.parse(
        runProcess(binary, ["info", "version", "--json"])
      ) as { path: string };
      this.resourceRoots_ = {
        binary: binary.path,
        package: realpathSync(info.path),
      };
    }
    const dist = realpathSync(candidate);
    const confined = (root: string, path: string) => {
      const rel = relative(root, path);
      return (
        rel !== "" &&
        rel !== ".." &&
        !rel.startsWith(`..${sep}`) &&
        !isAbsolute(rel)
      );
    };
    let root = this.resourceRoots_.package;
    if (!confined(root, dist)) {
      // LFS-backed viewers live in precisely platformdirs' package cache/dist,
      // not below the installation. Ask the selected local Python environment
      // for that path; neither the HTTP response nor the whole cache is trusted.
      // The extension's appdirs helper differs from platformdirs on macOS/Windows.
      if (!this.resourceRoots_.cache) {
        const cache: unknown = JSON.parse(
          runPython([
            "-c",
            "import json, sys; from platformdirs import user_cache_path; print(json.dumps(str(user_cache_path(sys.argv[1]) / 'dist')))",
            this.packageName_,
          ])
        );
        if (typeof cache !== "string" || !isAbsolute(cache)) {
          throw new Error("Invalid local view cache path");
        }
        this.resourceRoots_.cache = cache;
      }
      const cache = this.resourceRoots_.cache;
      if (!existsSync(cache) || dist !== realpathSync(cache)) {
        throw new Error(
          "View resource path is outside the installed package or its dist cache"
        );
      }
      root = dist;
    }
    if (!confined(root, realpathSync(join(dist, "index.html")))) {
      throw new Error(
        "View resource path is outside the installed package or its dist cache"
      );
    }
    // Keep the reported spelling for asset URIs and registered resource roots.
    return toAbsolutePath(candidate);
  }

  private stop(instance: ServerInstance) {
    if (instance.controller.signal.aborted) return;
    if (this.server_ === instance) this.server_ = undefined;
    instance.controller.abort();
    instance.token = "";
    instance.port = undefined;
    instance.cancelStartup?.(
      new Error(`${this.packageBin_} view startup cancelled`)
    );
    const child = instance.child;
    if (
      child &&
      child.exitCode === null &&
      child.signalCode === null &&
      !child.killed
    ) {
      child.kill();
    }
  }

  private shutdown() {
    this.resourceRoots_ = undefined;
    if (this.server_) this.stop(this.server_);
  }

  dispose() {
    this.disposed_ = true;
    this.shutdown();
    this.outputChannel_.dispose();
  }

  private outputChannel_: OutputChannel;
  private serverStartupLock_ = new AsyncLock();
  private server_?: ServerInstance;
  private disposed_ = false;
  // Initial LFS resolution downloads viewer assets before the readiness banner.
  private startupTimeoutMs_ = 180_000;
  private resourceRoots_?: { binary: string; package: string; cache?: string };
}
