import { ExtensionContext, Uri, ViewColumn } from "vscode";

import {
  InspectWebview,
  InspectWebviewManager,
} from "../../components/webview";
import { ExtensionHost, HostWebviewPanel } from "../../hooks";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { dirname, getRelativeUri } from "../../core/uri";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { ScanviewState } from "./scanview-state";
import { ScanviewPanel } from "./scanview-panel";
import { scoutViewPath } from "../../scout/props";
import { ScoutViewServer } from "../scout/scout-view-server";
import { ListingMRU } from "../../core/listing-mru";
import { selectDirectory } from "../../core/select";

const kScanViewId = "inspect.scanview";

export class ScoutViewManager {
  constructor(
    private readonly context_: ExtensionContext,
    private readonly webViewManager_: ScoutViewWebviewManager,
    private readonly envMgr_: WorkspaceEnvManager
  ) {}

  public async showScoutView() {
    // pick a directory
    let results_dir = await selectScanResultsDirectory(
      this.context_,
      this.envMgr_
    );
    if (results_dir === null) {
      results_dir = this.envMgr_.getDefaultScanResultsDir();
    }
    if (results_dir) {
      // Show the log view for the log dir (or the workspace)
      await this.webViewManager_.showScanview({ results_dir }, "activate");
    }
  }

  public async showScanDir(uri: Uri, activation?: "open" | "activate") {
    await this.webViewManager_.showScanDir(uri, activation);
  }

  public scanDirWillVisiblyUpdate(uri: Uri): boolean {
    return (
      this.webViewManager_.isVisible() &&
      this.webViewManager_.scanDirIsWithinResultsDir(uri)
    );
  }

  public viewColumn() {
    return this.webViewManager_.viewColumn();
  }
}

export class ScoutViewWebviewManager extends InspectWebviewManager<
  ScoutViewWebview,
  ScoutViewServer,
  ScanviewState
> {
  constructor(
    scoutManager: PackageManager,
    server: ScoutViewServer,
    context: ExtensionContext,
    host: ExtensionHost
  ) {
    // If the interpreter changes then
    context.subscriptions.push(
      scoutManager.onPackageChanged((e: PackageChangedEvent) => {
        if (!e.available && this.activeView_) {
          this.activeView_?.dispose();
        }
      })
    );

    // register view dir as local resource root
    const localResourceRoots: Uri[] = [];
    const viewDir = scoutViewPath();
    if (viewDir) {
      localResourceRoots.push(Uri.file(viewDir.path));
    }
    super(
      context,
      server,
      kScanViewId,
      "Scout View",
      localResourceRoots,
      ScoutViewWebview,
      host
    );
  }
  private activeResultsDir_: Uri | null = null;

  public async showScanDir(uri: Uri, activation?: "open" | "activate") {
    // Get the directory name using posix path methods
    const results_dir = dirname(uri);

    await this.showScanview({ scan_dir: uri, results_dir }, activation);
  }

  public scanDirIsWithinResultsDir(scan_dir: Uri) {
    const state = this.getWorkspaceState();
    return (
      state?.results_dir !== undefined &&
      getRelativeUri(state?.results_dir, scan_dir) !== null
    );
  }

  public async showScanDirIfWithinResultsDir(scan_dir: Uri) {
    const state = this.getWorkspaceState();
    if (state?.results_dir) {
      if (getRelativeUri(state?.results_dir, scan_dir) !== null) {
        await this.displayScanDir({
          scan_dir: scan_dir,
          results_dir: state?.results_dir,
          background_refresh: true,
        });
      }
    }
  }

  public async showScanview(
    state: ScanviewState,
    activation?: "open" | "activate"
  ) {
    // update state for restoring the workspace
    this.setWorkspaceState(state);

    switch (activation) {
      case "open":
        await this.displayScanDir(state, activation);
        break;
      case "activate":
        await this.displayScanDir(state, activation);
        break;
      default:
        // No activation, just refresh this in the background
        if (this.isVisible() && state.scan_dir) {
          this.updateViewState(state);

          // Signal the viewer to either perform a background refresh
          // or to check whether the view is focused and call us back to
          // display a log file
          await this.activeView_?.backgroundUpdate(
            state.scan_dir.path,
            state.results_dir.toString()
          );
        }
        return;
    }
  }

  public viewColumn() {
    return this.activeView_?.webviewPanel().viewColumn;
  }

  protected override async onViewStateChanged(): Promise<void> {
    if (this.isActive()) {
      await this.updateVisibleView();
    }
  }

  public async displayScanDir(
    state: ScanviewState,
    activation?: "open" | "activate"
  ) {
    // Determine whether we are showing a scan viewer for this directory
    // If we aren't close the log viewer so a fresh one can be opened.
    if (
      this.activeResultsDir_ !== null &&
      state.results_dir.toString() !== this.activeResultsDir_.toString()
    ) {
      // Close it
      this.activeView_?.dispose();
      this.activeView_ = undefined;
    }

    // Note the results dir that we are showing
    this.activeResultsDir_ = state.results_dir || null;

    // Update the view state
    this.updateViewState(state);

    // Ensure that we send the state once the view is loaded
    this.setOnShow(() => {
      this.updateVisibleView().catch(() => {});
    });

    // If the view is closed, clear the state
    this.setOnClose(() => {
      this.lastState_ = undefined;
      this.activeResultsDir_ = null;
    });

    // Actually reveal or show the webview
    if (this.activeView_) {
      if (activation === "activate") {
        this.revealWebview(activation !== "activate");
      } else if (state.scan_dir) {
        await this.activeView_?.backgroundUpdate(
          state.scan_dir.path,
          state.results_dir.toString()
        );
      }
    } else {
      if (activation) {
        this.showWebview(state, {
          preserveFocus: activation !== "activate",
          viewColumn: ViewColumn.Beside,
        });
      }
    }

    // TODO: there is probably a better way to handle this
    this.activeView_?.setManager(this);
  }

  private async updateVisibleView() {
    if (this.activeView_ && this.isVisible() && this.lastState_) {
      await this.activeView_.update(this.lastState_);
    }
  }

  private updateViewState(state: ScanviewState) {
    if (!this.lastState_ || !scanStateEquals(state, this.lastState_)) {
      this.lastState_ = state;
    }
  }

  protected override getWorkspaceState(): ScanviewState | undefined {
    const data: Record<string, string> = this.context_.workspaceState.get(
      this.kScoutViewState,
      {}
    );
    if (data) {
      return {
        results_dir: Uri.parse(data["results_dir"]),
        scan_dir: data["scan_dir"] ? Uri.parse(data["scan_dir"]) : undefined,
        background_refresh: !!data["background_refresh"],
      };
    } else {
      return this.lastState_;
    }
  }

  protected setWorkspaceState(state: ScanviewState) {
    void this.context_.workspaceState.update(this.kScoutViewState, {
      results_dir: state.results_dir.toString(),
      scan_dir: state.scan_dir?.toString(),
      background_refresh: state.background_refresh,
    });
  }

  private kScoutViewState = "scoutViewState";

  private lastState_?: ScanviewState = undefined;
}

const scanStateEquals = (a: ScanviewState, b: ScanviewState) => {
  if (a.results_dir.toString() !== b.results_dir.toString()) {
    return false;
  }

  if (!a.scan_dir && b.scan_dir) {
    return false;
  } else if (a.scan_dir && !b.scan_dir) {
    return false;
  } else if (a.scan_dir && b.scan_dir) {
    return a.scan_dir.toString() === b.scan_dir.toString();
  }
  return true;
};

class ScoutViewWebview extends InspectWebview<ScanviewState> {
  private readonly scanviewPanel_: ScanviewPanel;

  public constructor(
    context: ExtensionContext,
    server: ScoutViewServer,
    state: ScanviewState,
    webviewPanel: HostWebviewPanel
  ) {
    super(context, webviewPanel);

    this.scanviewPanel_ = new ScanviewPanel(
      webviewPanel,
      context,
      server,
      "results",
      state.results_dir
    );
    this._register(this.scanviewPanel_);

    this.show(state);
  }

  public setManager(manager: ScoutViewWebviewManager) {
    if (this._manager !== manager) {
      this._manager = manager;
    }
  }
  _manager: ScoutViewWebviewManager | undefined;

  public async update(state: ScanviewState) {
    await this._webviewPanel.webview.postMessage({
      type: "updateState",
      url: state.scan_dir?.toString(),
    });
  }

  public async backgroundUpdate(scan_dir: string, results_dir: string) {
    await this._webviewPanel.webview.postMessage({
      type: "backgroundUpdate",
      url: scan_dir,
      results_dir,
    });
  }

  protected getHtml(state: ScanviewState): string {
    return this.scanviewPanel_.getHtml(state);
  }
}

const kScanResultsMruKey = "inspect_ai.scan-results-listing-mru";

export class ScanResultsListingMRU extends ListingMRU {
  constructor(context_: ExtensionContext) {
    super(kScanResultsMruKey, context_);
  }
}

async function selectScanResultsDirectory(
  context: ExtensionContext,
  envManager: WorkspaceEnvManager
) {
  return await selectDirectory(
    "Scan Results Directory",
    "scans",
    envManager.getDefaultScanResultsDir(),
    new ScanResultsListingMRU(context)
  );
}
