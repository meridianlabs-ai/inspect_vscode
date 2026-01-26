import { ChildProcess, SpawnOptions } from "child_process";
import { randomUUID } from "crypto";
import * as os from "os";
import AsyncLock from "async-lock";

import { Disposable, ExtensionContext, OutputChannel, window } from "vscode";

import { findOpenPort } from "../../core/port";
import { AbsolutePath, activeWorkspacePath } from "../../core/path";
import { shQuote } from "../../core/string";
import { spawnProcess } from "../../core/process";
import { PackageManager } from "./manager";

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

  protected async api_json(
    path: string,
    headers?: Record<string, string>,
    handleError?: (status: number) => string | undefined
  ): Promise<{ data: string; headers: Headers }> {
    const result = await this.api(path, false, headers, handleError);
    return {
      data: result.data as string,
      headers: result.headers,
    };
  }

  protected async api_bytes(
    path: string
  ): Promise<{ data: Uint8Array; headers: Headers }> {
    const result = await this.api(path, true);
    return {
      data: result.data as Uint8Array,
      headers: result.headers,
    };
  }

  protected async apiGeneric(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    headers: Record<string, string>,
    body?: string
  ): Promise<{ status: number; data: string | Uint8Array; headers: Headers }> {
    await this.ensureRunning();

    const requestHeaders: Record<string, string> = {
      ...headers,
      Authorization: this.serverAuthToken_,
      Pragma: "no-cache",
      Expires: "0",
      "Cache-Control": "no-cache",
    };

    const response = await fetch(
      `http://localhost:${this.serverPort_}${path}`,
      { method, headers: requestHeaders, body }
    );

    const isBinary = response.headers
      .get("Content-Type")
      ?.includes("application/vnd.apache.arrow");

    const data = isBinary
      ? new Uint8Array(await response.arrayBuffer())
      : await response.text();

    return { status: response.status, data, headers: response.headers };
  }

  protected async api(
    path: string,
    binary: boolean = false,
    headers: Record<string, string> = {},
    handleError?: (status: number) => string | undefined
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

    // make request
    const response = await fetch(
      `http://localhost:${this.serverPort_}${path}`,
      { method: "GET", headers }
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
            ].concat(this.viewArgs_);
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
