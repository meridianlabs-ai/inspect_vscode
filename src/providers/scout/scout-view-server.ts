import { ExtensionContext } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { scoutBinPath } from "../../scout/props";

export class ScoutViewServer extends PackageViewServer {
  constructor(context: ExtensionContext, scoutManager: PackageManager) {
    super(context, scoutManager, 7576, "scout", scoutBinPath, [
      "--display",
      "rich",
    ]);
  }
}
