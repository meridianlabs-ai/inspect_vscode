import { ExtensionContext } from "vscode";
import { scoutBinPath } from "../../scout/props";
import { PackageManager } from "../../core/package/manager";

// Activates the provider which tracks the availability of Scout
export function activateScoutManager(context: ExtensionContext) {
  return new PackageManager(context, scoutBinPath);
}

