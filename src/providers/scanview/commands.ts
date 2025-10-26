import vscode from "vscode";

import { Command } from "../../core/command";
import { showError } from "../../components/error";
import { commands, ExtensionContext } from "vscode";

import { ScoutViewManager } from "./scanview-view";
import { ListingMRU } from "../../core/listing-mru";
import { selectDirectory } from "../../core/select";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

export async function scanviewCommands(
  context: ExtensionContext,
  manager: ScoutViewManager,
  envManager: WorkspaceEnvManager
): Promise<Command[]> {
  return [
    new ShowScanviewCommand(manager),
    new ShowOpenScanCommand(context, envManager),
  ];
}

class ShowScanviewCommand implements Command {
  constructor(private readonly manager_: ScoutViewManager) {}
  async execute(): Promise<void> {
    try {
      await this.manager_.showScoutView();
    } catch (err: unknown) {
      await showError(
        "An error occurred while attempting to start Scout View",
        err instanceof Error ? err : Error(String(err))
      );
    }
  }

  private static readonly id = "inspect.scoutView";
  public readonly id = ShowScanviewCommand.id;
}

class ShowOpenScanCommand implements Command {
  constructor(
    private context_: ExtensionContext,
    private envManager_: WorkspaceEnvManager
  ) {}
  async execute(): Promise<void> {
    try {
      const uri = await selectScanDirectory(this.context_, this.envManager_);
      if (uri) {
        await commands.executeCommand("inspect.openScanViewer", uri);
      }
    } catch (err: unknown) {
      // pass
    }
  }

  private static readonly id = "inspect.scoutViewScan";
  public readonly id = ShowOpenScanCommand.id;
}

const kScanDirMruKey = "inspect_ai.scan-dir-listing-mru";

class ScanDirListingMRU extends ListingMRU {
  constructor(context_: ExtensionContext) {
    super(kScanDirMruKey, context_);
  }
}

async function selectScanDirectory(
  context: ExtensionContext,
  envManager: WorkspaceEnvManager
) {
  return await selectDirectory(
    "Scan Directory",
    "scan_id=<scan_id>",
    vscode.Uri.joinPath(
      envManager.getDefaultScanResultsDir(),
      "scan_id=<scan_id>"
    ),
    new ScanDirListingMRU(context),
    false
  );
}
