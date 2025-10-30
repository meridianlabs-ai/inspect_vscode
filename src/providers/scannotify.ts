import { window, ExtensionContext, MessageItem, commands } from "vscode";
import { OutputWatcher } from "../core/package/output-watcher";
import { InspectSettingsManager } from "./settings/inspect-settings";

export function activateScanNotify(
  context: ExtensionContext,
  outputWatcher: OutputWatcher,
  settingsMgr: InspectSettingsManager
) {
  context.subscriptions.push(
    outputWatcher.onScoutScanCreated(async e => {
      if (e.externalWorkspace) {
        return;
      }

      if (!settingsMgr.getSettings().notifyScanComplete) {
        return;
      }

      // show the message
      const viewScan: MessageItem = { title: "View Scan" };
      const dontShowAgain: MessageItem = { title: "Don't Show Again" };
      const result = await window.showInformationMessage(
        `Scan complete.`,
        viewScan,
        dontShowAgain
      );
      if (result === viewScan) {
        // open the editor
        await commands.executeCommand("inspect.openScanViewer", e.scan);
      } else if (result === dontShowAgain) {
        settingsMgr.setNotifyScanComplete(false);
      }
    })
  );
}
