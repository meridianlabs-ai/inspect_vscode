import { commands, ExtensionContext, MessageItem, Uri, window } from "vscode";

import { OutputWatcher } from "../core/package/output-watcher";
import { basename } from "../core/uri";

import { InspectViewManager } from "./logview/logview-view";
import { InspectSettingsManager } from "./settings/inspect-settings";

/**
 * Derives a human-readable task name from a log URI.
 *
 * Inspect log files are named `<timestamp>_<task>_<id>.eval`, so the task is
 * the second underscore-delimited segment of the filename. Uses basename()
 * (which is separator- and scheme-aware) rather than splitting on "/", which
 * was fragile for Windows-style paths.
 */
export function taskNameFromLog(log: Uri): string {
  const fileName = basename(log);
  const parts = fileName.split("_");
  return parts[1] ?? "task";
}

export function activateLogNotify(
  context: ExtensionContext,
  outputWatcher: OutputWatcher,
  settingsMgr: InspectSettingsManager,
  viewManager: InspectViewManager
) {
  context.subscriptions.push(
    outputWatcher.onInspectLogCreated(async (e) => {
      if (e.externalWorkspace) {
        return;
      }

      if (!settingsMgr.getSettings().notifyEvalComplete) {
        return;
      }

      if (viewManager.logFileWillVisiblyUpdate(e.log)) {
        return false;
      }

      // see if we can pick out the task name
      const task = taskNameFromLog(e.log);

      // show the message
      const viewLog: MessageItem = { title: "View Log" };
      const dontShowAgain: MessageItem = { title: "Don't Show Again" };
      const result = await window.showInformationMessage(
        `Eval complete: ${task}`,
        viewLog,
        dontShowAgain
      );
      if (result === viewLog) {
        // open the editor
        await commands.executeCommand("inspect.openLogViewer", e.log);
      } else if (result === dontShowAgain) {
        settingsMgr.setNotifyEvalComplete(false);
      }
    })
  );
}
