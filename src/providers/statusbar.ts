import { ExtensionContext, StatusBarAlignment, window } from "vscode";
import { inspectVersion } from "../inspect";
import { inspectBinPath } from "../inspect/props";
import { PackageManager } from "../core/package/manager";

export function activateStatusBar(
  context: ExtensionContext,
  inspectManager: PackageManager
) {
  const statusItem = window.createStatusBarItem(
    "inspect-ai.version",
    StatusBarAlignment.Right
  );

  // track changes to inspect
  const updateStatus = () => {
    statusItem.name = "Inspect";
    const version = inspectVersion();
    const versionSummary = version
      ? `${version.version.toString()}${version.isDeveloperBuild ? ".dev" : ""}`
      : "(not found)";
    statusItem.text = `Inspect: ${versionSummary}`;
    statusItem.tooltip =
      `Inspect: ${version?.raw}` +
      (version ? `\n${inspectBinPath()?.path}` : "");
  };
  context.subscriptions.push(inspectManager.onPackageChanged(updateStatus));

  // reflect current state
  updateStatus();
  statusItem.show();
}
