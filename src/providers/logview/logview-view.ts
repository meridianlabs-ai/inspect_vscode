import { ExtensionContext, Uri, ViewColumn } from "vscode";

import {
  InspectWebview,
  InspectWebviewManager,
} from "../../components/webview";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { OutputWatcher } from "../../core/package/output-watcher";
import { dirname, getRelativeUri } from "../../core/uri";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { selectLogDirectory } from "../activity-bar/log-listing/log-directory-selector";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

import { LogviewPanel } from "./logview-panel";
import { LogviewState } from "./logview-state";

const kLogViewId = "inspect.logview";

export class InspectViewManager {
  constructor(
    private readonly context_: ExtensionContext,
    private readonly webViewManager_: InspectViewWebviewManager,
    private readonly envMgr_: WorkspaceEnvManager,
    outputWatcher: OutputWatcher
  ) {
    this.context_.subscriptions.push(
      outputWatcher.onInspectLogCreated(async (e) => {
        // if this log is contained in the directory currently being viewed
        // then do a background refresh on it
        if (this.webViewManager_.hasWebview()) {
          await this.webViewManager_.showLogFileIfWithinLogDir(e.log);
        }
      })
    );
  }

  public async showInspectView() {
    // pick a directory
    let log_dir = await selectLogDirectory(this.context_, this.envMgr_);
    if (log_dir === null) {
      log_dir = this.envMgr_.getDefaultLogDir();
    }
    if (log_dir) {
      // Show the log view for the log dir (or the workspace)
      await this.webViewManager_.showLogview({ log_dir }, "activate");
    }
  }

  public async showLogFile(uri: Uri, activation?: "open" | "activate") {
    await this.webViewManager_.showLogFile(uri, activation);
  }

  public logFileWillVisiblyUpdate(uri: Uri): boolean {
    return (
      this.webViewManager_.isVisible() &&
      this.webViewManager_.logFileIsWithinLogDir(uri)
    );
  }

  public viewColumn() {
    return this.webViewManager_.viewColumn();
  }
}

export class InspectViewWebviewManager extends InspectWebviewManager<
  InspectViewWebview,
  InspectViewServer,
  LogviewState
> {
  constructor(
    inspectManager: PackageManager,
    server: InspectViewServer,
    context: ExtensionContext
  ) {
    // If the interpreter changes, refresh the tasks
    context.subscriptions.push(
      inspectManager.onPackageChanged((e: PackageChangedEvent) => {
        if (!e.available && this.activeView_) {
          this.activeView_?.dispose();
        }
      })
    );

    // register view dir as local resource root
    const localResourceRoots: Uri[] = [];
    const viewDir = inspectViewPath();
    if (viewDir) {
      localResourceRoots.push(Uri.file(viewDir.path));
    }
    super(
      context,
      server,
      kLogViewId,
      "Inspect View",
      localResourceRoots,
      InspectViewWebview
    );
  }
  // Identifies the active panel's authorization scope. A "file"-scoped panel is
  // keyed by its file, a "dir"-scoped panel by its directory, so the panel is
  // recreated when the requested scope changes (not only when the directory
  // changes) — otherwise a legacy file-scoped panel reused for a different file
  // would reject it via the RPC scope guard.
  private activeScopeKey_: string | null = null;

  public async showLogFile(uri: Uri, activation?: "open" | "activate") {
    // Get the directory name using posix path methods
    const log_dir = dirname(uri);

    // Single-file open (the legacy path): confine the panel's RPC scope to this
    // one file, not its entire parent directory, matching the hardened
    // custom-editor path. See CWE-863.
    await this.showLogview(
      { log_file: uri, log_dir, scopeType: "file" },
      activation
    );
  }

  // Whether an updated log falls within the panel's actual scope. A "file"-scoped
  // panel (legacy single-file open) only matches its own file; a "dir" panel
  // matches any descendant. Using the panel scope avoids background-refreshing a
  // file-scoped panel toward a sibling, which the RPC guard would then reject.
  private logFileInScope(
    state: LogviewState | undefined,
    log_file: Uri
  ): boolean {
    if (!state?.log_dir) {
      return false;
    }
    if (state.scopeType === "file") {
      return state.log_file?.toString() === log_file.toString();
    }
    return getRelativeUri(state.log_dir, log_file) !== null;
  }

  public logFileIsWithinLogDir(log_file: Uri) {
    return this.logFileInScope(this.getWorkspaceState(), log_file);
  }

  public async showLogFileIfWithinLogDir(log_file: Uri) {
    const state = this.getWorkspaceState();
    if (state?.log_dir && this.logFileInScope(state, log_file)) {
      await this.displayLogFile({
        log_file: log_file,
        log_dir: state.log_dir,
        background_refresh: true,
      });
    }
  }

  public async showLogview(
    state: LogviewState,
    activation?: "open" | "activate"
  ) {
    // update state for restoring the workspace
    this.setWorkspaceState(state);

    switch (activation) {
      case "open":
        await this.displayLogFile(state, activation);
        break;
      case "activate":
        await this.displayLogFile(state, activation);
        break;
      default:
        // No activation, just refresh this in the background
        if (this.isVisible() && state.log_file) {
          this.updateViewState(state);

          // Tell the viewer the directory changed so it refreshes its log
          // listing (only dir-scoped panels render one; file-scoped panels
          // never receive this for other logs, see logFileInScope).
          await this.activeView_?.backgroundUpdate(
            state.log_file.path,
            state.log_dir.toString()
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

  public async displayLogFile(
    state: LogviewState,
    activation?: "open" | "activate"
  ) {
    // Recreate the panel whenever the requested authorization scope changes —
    // by directory for a dir view, or by file for a single-file (legacy) view.
    // Keying only on log_dir would reuse a file-scoped panel for a different
    // file in the same directory, and its fixed RPC scope guard would then
    // reject the new file.
    const scopeKey =
      state.scopeType === "file" && state.log_file
        ? `file:${state.log_file.toString()}`
        : `dir:${state.log_dir.toString()}`;
    if (this.activeScopeKey_ !== null && scopeKey !== this.activeScopeKey_) {
      // Close it
      this.activeView_?.dispose();
      this.activeView_ = undefined;
    }

    // Note the scope that we are showing
    this.activeScopeKey_ = scopeKey;

    // Update the view state
    this.updateViewState(state);

    // Ensure that we send the state once the view is loaded
    this.setOnShow(() => {
      this.updateVisibleView().catch(() => {});
    });

    // If the view is closed, clear the state
    this.setOnClose(() => {
      this.lastState_ = undefined;
      this.activeScopeKey_ = null;
    });

    // Actually reveal or show the webview
    if (this.activeView_) {
      if (activation === "activate") {
        this.revealWebview(activation !== "activate");
      } else if (state.log_file) {
        await this.activeView_?.backgroundUpdate(
          state.log_file.path,
          state.log_dir.toString()
        );
      }
    } else {
      if (activation) {
        this.showWebview(state, {
          preserveFocus: activation !== "activate",
          viewColumn: ViewColumn.One,
        });
      }
    }
  }

  private async updateVisibleView() {
    if (this.activeView_ && this.isVisible() && this.lastState_) {
      await this.activeView_.update(this.lastState_);
    }
  }

  private updateViewState(state: LogviewState) {
    if (!this.lastState_ || !logStateEquals(state, this.lastState_)) {
      this.lastState_ = state;
    }
  }

  protected override getWorkspaceState(): LogviewState | undefined {
    const data: Record<string, string> = this.context_.workspaceState.get(
      this.kInspectViewState,
      {}
    );
    // Only treat this as trusted state when a real log_dir was persisted.
    // Uri.parse("") resolves to file:/// (whole filesystem), so an empty/never-
    // set value must NOT become a panel scope — fall back to the in-memory
    // last state (undefined on a fresh restore, which disposes the panel).
    if (data && data["log_dir"]) {
      return {
        log_dir: Uri.parse(data["log_dir"]),
        log_file: data["log_file"] ? Uri.parse(data["log_file"]) : undefined,
        background_refresh: !!data["background_refresh"],
        // Persist the scope type so a restored single-file panel keeps its
        // tight "file" scope rather than defaulting back to "dir" (its parent).
        scopeType: data["scopeType"] === "file" ? "file" : undefined,
      };
    } else {
      return this.lastState_;
    }
  }

  // The log view's panel scope (log_dir) is security-relevant, so on restore it
  // must come only from extension-managed workspaceState — never from the
  // webview-persisted state, which a compromised viewer can forge via setState.
  // Returning undefined (no trusted state) disposes the panel rather than
  // restoring it with an attacker-chosen scope. See CWE-642.
  protected override restoreState(): LogviewState | undefined {
    return this.getWorkspaceState();
  }

  protected setWorkspaceState(state: LogviewState) {
    void this.context_.workspaceState.update(this.kInspectViewState, {
      log_dir: state.log_dir.toString(),
      log_file: state.log_file?.toString(),
      background_refresh: state.background_refresh,
      scopeType: state.scopeType,
    });
  }

  private kInspectViewState = "inspectViewState";

  private lastState_?: LogviewState = undefined;
}

const logStateEquals = (a: LogviewState, b: LogviewState) => {
  if (a.log_dir.toString() !== b.log_dir.toString()) {
    return false;
  }

  if (!a.log_file && b.log_file) {
    return false;
  } else if (a.log_file && !b.log_file) {
    return false;
  } else if (a.log_file && b.log_file) {
    return a.log_file.toString() === b.log_file.toString();
  }
  return true;
};

class InspectViewWebview extends InspectWebview<LogviewState> {
  private readonly logviewPanel_: LogviewPanel;

  public constructor(
    context: ExtensionContext,
    server: InspectViewServer,
    state: LogviewState,
    webviewPanel: HostWebviewPanel
  ) {
    super(context, webviewPanel);

    // The panel's authorization scope is fixed here at construction. A "file"
    // scope (legacy single-file open) confines the RPC surface to log_file; the
    // default "dir" scope confines it to descendants of log_dir. The webview
    // cannot change this afterwards.
    this.scopeType_ = state.scopeType ?? "dir";
    this.scopeUri_ =
      this.scopeType_ === "file" && state.log_file
        ? state.log_file
        : state.log_dir;

    this.logviewPanel_ = new LogviewPanel(
      webviewPanel,
      context,
      server,
      this.scopeType_,
      this.scopeUri_
    );
    this._register(this.logviewPanel_);

    void this.show(state);
  }

  private readonly scopeType_: "file" | "dir";
  private readonly scopeUri_: Uri;

  public async update(state: LogviewState) {
    await this._webviewPanel.webview.postMessage({
      type: "updateState",
      url: state.log_file?.toString(),
    });
  }

  // Notify the viewer that a log in its directory was created or changed.
  // Current viewers only refresh their log listing on this message; the
  // `url`/`log_dir` fields are kept for older bundled viewers that still
  // read them. (Older viewers also used this to select the new log when
  // unfocused and to call back via a `displayLogFile` message; both paths
  // were broken and have been removed on both sides.)
  public async backgroundUpdate(file: string, log_dir: string) {
    await this._webviewPanel.webview.postMessage({
      type: "backgroundUpdate",
      url: file,
      log_dir,
    });
  }

  protected async getHtml(state: LogviewState): Promise<string> {
    return await this.logviewPanel_.getHtml(state);
  }
}
