import {
  commands,
  ExtensionContext,
  TextDocumentShowOptions,
  Uri,
} from "vscode";

import { withEditorAssociation } from "../core/vscode/association";
import { hasMinimumInspectVersion } from "../inspect/version";

import { kInspectEvalLogFormatVersion } from "./inspect/inspect-constants";
import { kInspectLogViewType } from "./logview/logview-editor";
import { InspectViewManager } from "./logview/logview-view";

export function activateOpenLog(
  context: ExtensionContext,
  viewManager: InspectViewManager
) {
  context.subscriptions.push(
    commands.registerCommand(
      "inspect.openLogViewer",
      async (uri: Uri | string) => {
        uri = typeof uri === "string" ? Uri.parse(uri) : uri;

        // function to open using defualt editor in preview mode
        const openLogViewer = async () => {
          await commands.executeCommand("vscode.open", uri, <
            TextDocumentShowOptions
          >{ preview: true });
        };

        if (hasMinimumInspectVersion(kInspectEvalLogFormatVersion)) {
          // Clean query params or fragment
          const cleanUri = uri.with({ query: "", fragment: "" });
          if (cleanUri.path.endsWith(".eval")) {
            await openLogViewer();
          } else {
            await withEditorAssociation(
              {
                viewType: kInspectLogViewType,
                filenamePattern:
                  "{[0-9][0-9][0-9][0-9]}-{[0-9][0-9]}-{[0-9][0-9]}T{[0-9][0-9]}[:-]{[0-9][0-9]}[:-]{[0-9][0-9]}*{[A-Za-z0-9]{21}}*.json",
              },
              openLogViewer
            );
          }

          // notify the logs pane that we are doing this so that it can take a reveal action
          await commands.executeCommand("inspect.logListingReveal", uri);
        } else {
          await viewManager.showLogFile(uri, "activate");
        }
      }
    )
  );
}
