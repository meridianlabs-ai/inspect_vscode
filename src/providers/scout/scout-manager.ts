import { ExtensionContext } from "vscode";
import { scoutBinPath, scoutVersionDescriptor } from "../../scout/props";
import { PackageManager } from "../../core/package/manager";
import { SemVer } from "semver";

// Activates the provider which tracks the availability of Scout
export function activateScoutManager(context: ExtensionContext) {
  return new PackageManager(
    context,
    "inspect_scout",
    scoutBinPath,
    checkIsEnabled
  );
}

const checkIsEnabled = () => {
  const version = scoutVersionDescriptor();
  if (!version) {
    return false;
  }
  return supportsRouteMessages(version.version);
};

const supportsRouteMessages = (version: SemVer): boolean => {
  // Whether the scout version supports route messaging, used in vscode
  // extension version 0.9 and later
  return version.major >= 0 && version.minor >= 4 && version.patch > 12;
};
