import { ExtensionContext, ViewColumn, Uri, commands } from "vscode";
import { kScoutScanViewType } from "./scanview/scanview-editor";

export function activateOpenScan(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      "inspect.openScanViewer",
      async (uri: Uri | string) => {
        uri = typeof uri === "string" ? Uri.parse(uri) : uri;

        await commands.executeCommand(
          "vscode.openWith",
          uri,
          kScoutScanViewType,
          {
            viewColumn: ViewColumn.Active,
            preview: true,
          }
        );

        await commands.executeCommand("inspect.scanListingReveal", uri);
      }
    )
  );
}
