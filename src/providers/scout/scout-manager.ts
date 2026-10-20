import { ExtensionContext } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { VersionDescriptor } from "../../core/package/props";
import { hasMinimumPackageVersion } from "../../core/package/version";
import { scoutBinPath, scoutVersionDescriptor } from "../../scout/props";

// Activates the provider which tracks the availability of Scout
export function activateScoutManager(context: ExtensionContext) {
  return new PackageManager(
    context,
    "inspect_scout",
    scoutBinPath,
    checkIsEnabled
  );
}

const checkIsEnabled = () =>
  scoutSupportsRouteMessages(scoutVersionDescriptor());

// Route messaging, which extension 0.9 and later use, arrived in Scout 0.4.13.
export const scoutSupportsRouteMessages = (
  version: VersionDescriptor | null
): boolean => hasMinimumPackageVersion("0.4.13", version);
