import { ExtensionContext, StatusBarAlignment, window } from "vscode";
import { inspectVersion } from "../inspect";
import { inspectBinPath } from "../inspect/props";
import { PackageManager } from "../core/package/manager";
import { VersionDescriptor } from "../core/package/props";
import { AbsolutePath } from "../core/path";
import { scoutBinPath, scoutVersionDescriptor } from "../scout/props";

export function activateStatusBar(
  context: ExtensionContext,
  inspectManager: PackageManager,
  scoutManager: PackageManager
) {
  const statusItem = window.createStatusBarItem(
    "inspect-ai.version",
    StatusBarAlignment.Right
  );

  const packageStatus = (
    pkg: string,
    version: VersionDescriptor | null,
    binPath: AbsolutePath | null
  ): [string, string] => {
    const versionSummary = version
      ? `${version.version.toString()}${version.isDeveloperBuild ? ".dev" : ""}`
      : "(not found)";
    const text = `${pkg}: ${versionSummary}`;
    const tooltip =
      `${pkg}: ${version?.raw}` + (version ? `\n${binPath?.path}` : "");

    return [text, tooltip];
  };

  // track changes to inspect
  const updateStatus = () => {
    statusItem.name = "Inspect";

    const [inspectText, inspectTooltip] = packageStatus(
      "Inspect",
      inspectVersion(),
      inspectBinPath()
    );
    statusItem.text = inspectText;
    statusItem.tooltip = inspectTooltip;

    const scoutVer = scoutVersionDescriptor();
    if (scoutVer) {
      const [scoutText, scoutTooltip] = packageStatus(
        "Scout",
        scoutVer,
        scoutBinPath()
      );
      statusItem.text = `${statusItem.text}  ${scoutText}`;
      statusItem.tooltip = `${statusItem.tooltip}\n\n${scoutTooltip}`;
    }
  };
  context.subscriptions.push(inspectManager.onPackageChanged(updateStatus));
  context.subscriptions.push(scoutManager.onPackageChanged(updateStatus));

  // reflect current state
  updateStatus();
  statusItem.show();
}
