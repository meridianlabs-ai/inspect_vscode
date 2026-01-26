import { ExtensionContext, Uri } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { scoutBinPath } from "../../scout/props";

export interface HttpProxyRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding?: "utf8" | "base64";
}

export class ScoutViewServer extends PackageViewServer {
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
  }

  async getScans(results_dir?: Uri): Promise<string> {
    await this.ensureRunning();
    let uri = "/api/scans";
    if (results_dir) {
      uri = `${uri}?results_dir=${results_dir.toString()}`;
    }
    return (await this.api_json(uri)).data;
  }

  async getScan(scanLocation: string): Promise<string> {
    await this.ensureRunning();
    return (
      await this.api_json(
        `/api/scan/${encodeURIComponent(scanLocation)}?status_only=true`
      )
    ).data;
  }

  async getScannerDataframe(
    scanLocation: string,
    scanner: string
  ): Promise<Uint8Array> {
    const uri = `/api/scanner_df/${encodeURIComponent(
      scanLocation
    )}?scanner=${encodeURIComponent(scanner)}`;
    return (await this.api_bytes(uri)).data;
  }

  async getScannerDataframeInput(
    scanLocation: string,
    scanner: string,
    uuid: string
  ): Promise<[string, string]> {
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
  }

  async deleteScan(scanLocation: Uri): Promise<string> {
    await this.ensureRunning();
    return (
      await this.api_json(
        `/api/scan-delete/${encodeURIComponent(scanLocation.toString(true))}`
      )
    ).data;
  }

  async httpRequest(request: HttpProxyRequest): Promise<HttpProxyResponse> {
    const url = `/api/v2${request.path}`;
    const result = await this.apiGeneric(
      url,
      request.method,
      request.headers ?? {},
      request.body
    );

    const headers: Record<string, string> = {};
    result.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    if (result.data instanceof Uint8Array) {
      const chunks: string[] = [];
      const chunkSize = 0xffff;
      for (let i = 0; i < result.data.length; i += chunkSize) {
        chunks.push(
          String.fromCharCode(...result.data.subarray(i, i + chunkSize))
        );
      }
      return {
        status: result.status,
        headers,
        body: btoa(chunks.join("")),
        bodyEncoding: "base64",
      };
    }
    return {
      status: result.status,
      headers,
      body: result.data,
      bodyEncoding: "utf8",
    };
  }
}
