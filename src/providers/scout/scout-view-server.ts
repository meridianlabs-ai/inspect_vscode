import { ExtensionContext, Uri } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { scoutBinPath } from "../../scout/props";

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
    uuid: string,
    exclude?: string[]
  ): Promise<[string, string]> {
    let uri = `/api/scanner_df_input/${encodeURIComponent(
      scanLocation
    )}?scanner=${encodeURIComponent(scanner)}&uuid=${encodeURIComponent(uuid)}`;
    if (exclude) {
      for (const column of exclude) {
        uri = `${uri}&exclude=${encodeURIComponent(column)}`;
      }
    }
    const results = await this.api_json(uri);
    const input = results.data;
    const inputType = results.headers.get("X-Input-Type");

    if (inputType === null) {
      throw new Error("Missing X-Input-Type header");
    }

    return [input, inputType];
  }

  async getScannerField(
    scanLocation: string,
    scanner: string,
    row: string,
    column: string
  ): Promise<string> {
    const uri = `/scanner/${encodeURIComponent(scanLocation)}/${encodeURIComponent(scanner)}/${encodeURIComponent(row)}/${encodeURIComponent(column)}`;
    return (await this.api_json(uri)).data;
  }

  async deleteScan(scanLocation: Uri): Promise<string> {
    await this.ensureRunning();
    return (
      await this.api_json(
        `/api/scan-delete/${encodeURIComponent(scanLocation.toString(true))}`
      )
    ).data;
  }
}
