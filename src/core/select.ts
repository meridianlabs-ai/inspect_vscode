import {
  QuickPickItem,
  QuickPickItemKind,
  ThemeIcon,
  Uri,
  window,
} from "vscode";
import { prettyUriPath } from "./uri";
import { activeWorkspaceFolder } from "./workspace";
import { ListingMRU } from "./listing-mru";

const kSeparator = "<separator>";
const kWorkspaceLogDirectory = "<workspace-log-dir>";
const kSelectLocalDirectory = "<select-local>";
const kSelectRemoteURL = "<select-remote-url>";
const kClearRecentLocations = "<clear-recent>";

export interface SelectLocationQuickPickItem extends QuickPickItem {
  location: string;
}

export async function selectDirectory(
  entity: string,
  dirname: string,
  defaultDir: Uri,
  mru: ListingMRU
): Promise<Uri | null | undefined> {
  return new Promise<Uri | null | undefined>(resolve => {
    // get the mru (screen out the current workspaceLogDir)
    const mruLocations = mru
      .get()
      .filter(location => location.toString() !== defaultDir.toString());

    // build list of items
    const items: SelectLocationQuickPickItem[] = [];
    items.push({
      iconPath: new ThemeIcon("code-oss"),
      label: `Workspace ${entity}`,
      description: prettyUriPath(defaultDir),
      location: kWorkspaceLogDirectory,
    });
    items.push({
      label: "Select a location",
      kind: QuickPickItemKind.Separator,
      location: kSeparator,
    });
    items.push({
      iconPath: new ThemeIcon("vm"),
      label: `Local ${entity}...`,
      description: `${entity} on your local machine`,
      location: kSelectLocalDirectory,
    });
    items.push({
      iconPath: new ThemeIcon("remote-explorer"),
      label: `Remote ${entity}...`,
      description: `Remote storage (e.g. s3://my-bucket/${dirname})`,
      location: kSelectRemoteURL,
    });
    if (mruLocations.length > 0) {
      items.push({
        label: "Recent locations",
        kind: QuickPickItemKind.Separator,
        location: kSeparator,
      });
      for (const mruLocation of mruLocations) {
        items.push({
          label: mruLocation.path.split("/").pop()!,
          description: prettyUriPath(mruLocation),
          location: mruLocation.toString(),
        });
      }
      items.push({
        label: "",
        kind: QuickPickItemKind.Separator,
        location: kSeparator,
      });
      items.push({
        label: "Clear recent locations",
        location: kClearRecentLocations,
      });
    }

    // setup and show quick pick
    const quickPick = window.createQuickPick<SelectLocationQuickPickItem>();
    quickPick.canSelectMany = false;
    quickPick.items = items;
    let accepted = false;
    quickPick.onDidAccept(async () => {
      // accept and hide quickpick
      accepted = true;
      quickPick.hide();

      // process selection
      const location = quickPick.selectedItems[0].location;
      if (location === kWorkspaceLogDirectory) {
        resolve(null);
      } else if (location === kSelectLocalDirectory) {
        resolve(await selectLocalDirectory(entity));
      } else if (location === kSelectRemoteURL) {
        resolve(await selectRemoteURL(entity, dirname));
      } else if (location === kClearRecentLocations) {
        await mru.clear();
        resolve(undefined);
      } else {
        // selected from mru
        resolve(Uri.parse(location));
      }
    });
    quickPick.onDidHide(() => {
      if (!accepted) {
        resolve(undefined);
      }
    });
    quickPick.show();
  });
}

export async function selectLocalDirectory(
  entity: string
): Promise<Uri | undefined> {
  const selection = await window.showOpenDialog({
    title: `Local ${entity}`,
    openLabel: `Select ${entity}`,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: activeWorkspaceFolder().uri,
  });
  if (selection) {
    return selection[0];
  } else {
    return undefined;
  }
}

export async function selectRemoteURL(
  entity: string,
  dirname: string
): Promise<Uri | undefined> {
  const remoteUrl = await window.showInputBox({
    title: `Remote ${entity}`,
    prompt: `Provide a remote ${entity.toLowerCase()} (e.g. s3://my-bucket/${dirname})`,
    validateInput: value => {
      // don't try to validate empty string
      if (value.length === 0) {
        return null;
      }

      // check for parseable uri
      try {
        Uri.parse(value, true);
        return null;
      } catch (e) {
        return `Specified location is not a valid URI (e.g. s3://my-bucket/${dirname})`;
      }
    },
  });
  if (remoteUrl) {
    return Uri.parse(remoteUrl, true);
  } else {
    return undefined;
  }
}
