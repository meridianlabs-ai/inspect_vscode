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
      7576,
      "Scout",
      "scout",
      scoutBinPath,
      ["--display", "rich"],
      "http"
    );
  }

  async getScans(results_dir?: Uri): Promise<string> {
    let uri = "/api/scans";
    if (results_dir) {
      uri = `${uri}?results_dir=${results_dir.toString()}`;
    }
    return this.api_json(uri);
  }

  async getScan(scanLocation: string): Promise<string> {
    return this.api_json(`/api/scan/${encodeURIComponent(scanLocation)}`);
  }

  async deleteScan(scanLocation: Uri): Promise<string> {
    return this.api_json(
      `/api/scan-delete/${encodeURIComponent(scanLocation.toString(true))}`
    );
  }
}
