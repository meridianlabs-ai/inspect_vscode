import { ExtensionContext, Uri } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { scoutBinPath } from "../../scout/props";
import { basename, dirname } from "../../core/uri";

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

export class ScoutViewServer extends PackageViewServer {
  public readonly legacy: {
    getScans: (results_dir?: Uri) => Promise<string>;
    getScan: (scanLocation: string) => Promise<string>;
    getScannerDataframe: (
      scanLocation: string,
      scanner: string
    ) => Promise<Uint8Array>;
    getScannerDataframeInput: (
      scanLocation: string,
      scanner: string,
      uuid: string
    ) => Promise<[string, string]>;
    deleteScan: (scanLocation: Uri) => Promise<string>;
  };

  constructor(context: ExtensionContext, scoutManager: PackageManager) {
    super(
      context,
      scoutManager,
      ["view"],
      7776,
      "Scout",
      "scout",
      scoutBinPath,
      ["--display", "rich"],
      "http"
    );

    this.legacy = {
      getScans: async (results_dir?: Uri): Promise<string> => {
        await this.ensureRunning();
        let uri = "/api/scans";
        if (results_dir) {
          uri = `${uri}?results_dir=${results_dir.toString()}`;
        }
        return (await this.api_json(uri)).data;
      },

      getScan: async (scanLocation: string): Promise<string> => {
        await this.ensureRunning();
        return (
          await this.api_json(
            `/api/scan/${encodeURIComponent(scanLocation)}?status_only=true`
          )
        ).data;
      },

      getScannerDataframe: async (
        scanLocation: string,
        scanner: string
      ): Promise<Uint8Array> => {
        const uri = `/api/scanner_df/${encodeURIComponent(
          scanLocation
        )}?scanner=${encodeURIComponent(scanner)}`;
        return (await this.api_bytes(uri)).data;
      },

      getScannerDataframeInput: async (
        scanLocation: string,
        scanner: string,
        uuid: string
      ): Promise<[string, string]> => {
        const uri = `/api/scanner_df_input/${encodeURIComponent(
          scanLocation
        )}?scanner=${encodeURIComponent(scanner)}&uuid=${encodeURIComponent(uuid)}`;
        const results = await this.api_json(uri);
        const input = results.data;
        const inputType = results.headers.get("X-Input-Type");

        if (inputType === null) {
          throw new Error("Missing X-Input-Type header");
        }

        return [input, inputType];
      },

      deleteScan: async (scanLocation: Uri): Promise<string> => {
        await this.ensureRunning();
        return (
          await this.api_json(
            `/api/scan-delete/${encodeURIComponent(scanLocation.toString(true))}`
          )
        ).data;
      },
    };
  }

  async getScans(scans_dir: Uri): Promise<string> {
    await this.ensureRunning();
    const base64Dir = encodeURIComponent(
      Buffer.from(scans_dir.toString()).toString("base64")
    );
    const uri = `/api/v2/scans/${base64Dir}`;
    return (await this.api_json(uri, "POST")).data;
  }

  async deleteScan(scanLocation: Uri): Promise<string> {
    await this.ensureRunning();
    const dir = dirname(scanLocation);
    const file = basename(scanLocation);
    const base64Dir = encodeURIComponent(
      Buffer.from(dir.toString()).toString("base64")
    );
    const scanFile = encodeURIComponent(Buffer.from(file).toString("base64"));
    return (
      await this.api_json(`/api/v2/scans/${base64Dir}/${scanFile}`, "DELETE")
    ).data;
  }

  /**
   * JSON-RPC method handler that proxies webview HTTP requests to the backend.
   * Converts HttpProxyRpcRequest to fetch call, then serializes response for JSON-RPC transport.
   */
  async proxyRpcRequest(
    request: HttpProxyRpcRequest
  ): Promise<HttpProxyRpcResponse> {
    await this.ensureRunning();

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
        ? {
            body: Buffer.from(data).toString("base64"),
            bodyEncoding: "base64",
          }
        : {
            body: data,
            bodyEncoding: "utf8",
          }),
    };
  }
}
