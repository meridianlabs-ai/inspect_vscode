import { ExtensionContext, Uri } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { AbsolutePath, toAbsolutePath } from "../../core/path";
import { basename, dirname } from "../../core/uri";
import { scoutBinPath } from "../../scout/props";

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

  async getDistPath(): Promise<AbsolutePath | null> {
    const result = await this.api_json(
      "/api/v2/dist",
      "GET",
      undefined,
      (status: number) => (status === 404 ? "null" : undefined)
    );
    if (result.data === "null") {
      return null;
    }
    const { path } = JSON.parse(result.data) as { path: string };
    return toAbsolutePath(path);
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
}
