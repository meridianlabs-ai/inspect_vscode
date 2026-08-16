import { ExtensionContext, Uri, ViewColumn } from "vscode";

import { showError } from "../../components/error";
import {
  InspectWebview,
  InspectWebviewManager,
} from "../../components/webview";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { OutputWatcher } from "../../core/package/output-watcher";
import {
  dirname,
  ViewPathScope,
  viewPathScopeLocation,
  viewPathScopesEqual,
  viewPathUriString,
} from "../../core/uri";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { selectLogDirectory } from "../activity-bar/log-listing/log-directory-selector";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";

import { LogviewPanel } from "./logview-panel";
import {
  logFileIsInLogviewScope,
  logviewPathScope,
  LogviewState,
} from "./logview-state";

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
        // Refresh only when the new log is allowed by the current view scope.
        if (this.webViewManager_.hasWebview()) {
          await this.webViewManager_.showLogFileIfInViewScope(e.log);
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
      await this.webViewManager_.showLogview(
        { log_dir, scope_kind: "directory" },
        "activate"
      );
    }
  }

  public async showLogFile(
    uri: Uri,
    activation?: "open" | "activate",
    location?: string,
    canonical: boolean = false
  ) {
    await this.webViewManager_.showLogFile(
      uri,
      activation,
      location,
      canonical
    );
  }

  public async logFileWillVisiblyUpdate(uri: Uri): Promise<boolean> {
    return (
      this.webViewManager_.isVisible() &&
      (await this.webViewManager_.logFileIsInViewScope(uri))
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

  public async showLogFile(
    uri: Uri,
    activation?: "open" | "activate",
    location?: string,
    canonical: boolean = false
  ) {
    // Get the directory name using posix path methods
    const log_dir = dirname(uri);

    await this.showLogview(
      {
        log_file: uri,
        log_location: location,
        canonical_location: canonical,
        log_dir,
        scope_kind: "file",
      },
      activation
    );
  }

  public async logFileIsInViewScope(log_file: Uri): Promise<boolean> {
    const state = this.getWorkspaceState();
    const scope =
      this.activeView_?.scope() ??
      (state ? logviewPathScope(state) : undefined);
    return (
      scope !== undefined && (await logFileIsInLogviewScope(scope, log_file))
    );
  }

  public async showLogFileIfInViewScope(log_file: Uri) {
    const state = this.getWorkspaceState();
    if (state) {
      const scope = this.activeView_?.scope() ?? logviewPathScope(state);
      if (!(await logFileIsInLogviewScope(scope, log_file))) {
        return;
      }
      await this.displayLogFile({
        log_file: log_file,
        log_location: scope.canonical
          ? await viewPathScopeLocation(scope)
          : scope.opaqueLocation,
        canonical_location: scope.canonical,
        log_dir: state.log_dir,
        scope_kind: scope.kind,
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

          // Signal the viewer to either perform a background refresh
          // or to check whether the view is focused and call us back to
          // display a log file
          await this.activeView_?.backgroundUpdate(
            state.log_location ?? viewPathUriString(state.log_file),
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
    const activeScope = this.activeView_?.scope();
    const requestedScope = logviewPathScope(state);
    const scope =
      activeScope && viewPathScopesEqual(activeScope, requestedScope)
        ? activeScope
        : requestedScope;
    await scope.canonicalUri;
    if (activeScope && activeScope !== scope) {
      this.activeView_?.dispose();
      this.activeView_ = undefined;
    }

    state = { ...state, path_scope: scope };

    // Update the view state
    this.updateViewState(state);

    // Ensure that we send the state once the view is loaded
    this.setOnShow(() => {
      this.updateVisibleView().catch(() => {});
    });

    // If the view is closed, clear the state
    this.setOnClose(() => {
      this.lastState_ = undefined;
    });

    // Actually reveal or show the webview
    if (this.activeView_) {
      if (activation === "activate") {
        this.revealWebview(activation !== "activate");
      } else if (state.log_file) {
        await this.activeView_?.backgroundUpdate(
          state.log_location ?? viewPathUriString(state.log_file),
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

    // TODO: there is probably a better way to handle this
    this.activeView_?.setManager(this);
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
    if (data) {
      return {
        log_dir: Uri.parse(data["log_dir"] ?? ""),
        log_file: data["log_file"] ? Uri.parse(data["log_file"]) : undefined,
        log_location: data["log_location"] || undefined,
        canonical_location: data["canonical_location"] === "true",
        background_refresh: !!data["background_refresh"],
        scope_kind:
          data["scope_kind"] === "file" ||
          (!data["scope_kind"] && data["log_file"])
            ? "file"
            : "directory",
      };
    } else {
      return this.lastState_;
    }
  }

  protected setWorkspaceState(state: LogviewState) {
    void this.context_.workspaceState.update(this.kInspectViewState, {
      log_dir: state.log_dir.toString(),
      log_file: state.log_file ? viewPathUriString(state.log_file) : undefined,
      log_location: state.log_location,
      canonical_location: state.canonical_location ? "true" : undefined,
      background_refresh: state.background_refresh,
      scope_kind: state.scope_kind,
    });
  }

  private kInspectViewState = "inspectViewState";

  private lastState_?: LogviewState = undefined;
}

const logStateEquals = (a: LogviewState, b: LogviewState) => {
  if ((a.scope_kind ?? "directory") !== (b.scope_kind ?? "directory")) {
    return false;
  }
  if (a.log_dir.toString() !== b.log_dir.toString()) {
    return false;
  }

  if (!a.log_file && b.log_file) {
    return false;
  } else if (a.log_file && !b.log_file) {
    return false;
  } else if (a.log_file && b.log_file) {
    return (
      !!a.canonical_location === !!b.canonical_location &&
      (a.log_location ?? viewPathUriString(a.log_file)) ===
        (b.log_location ?? viewPathUriString(b.log_file))
    );
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

    const scope = logviewPathScope(state);
    this.logviewPanel_ = new LogviewPanel(webviewPanel, context, server, scope);
    this._register(this.logviewPanel_);

    this._register(
      this._webviewPanel.webview.onDidReceiveMessage(
        async (e: { type: string; url: string; [key: string]: unknown }) => {
          switch (e.type) {
            case "displayLogFile":
              {
                const logFile = await this.logviewPanel_.resolve(e.url);
                if (this._manager && logFile) {
                  const scope = this.logviewPanel_.scope();
                  const state: LogviewState = {
                    log_file: logFile,
                    log_location: scope.canonical
                      ? await viewPathScopeLocation(scope)
                      : scope.opaqueLocation,
                    canonical_location: scope.canonical,
                    log_dir:
                      scope.kind === "directory" ? scope.uri : dirname(logFile),
                    scope_kind: scope.kind,
                  };
                  await this._manager.displayLogFile(state, "open");
                } else {
                  await showError(
                    "Unable to display a log file outside the selected viewer scope."
                  );
                }
              }
              break;
          }
        }
      )
    );

    void this.show(state);
  }

  public setManager(manager: InspectViewWebviewManager) {
    if (this._manager !== manager) {
      this._manager = manager;
    }
  }
  _manager: InspectViewWebviewManager | undefined;

  public scope(): ViewPathScope {
    return this.logviewPanel_.scope();
  }

  public async update(state: LogviewState) {
    await this._webviewPanel.webview.postMessage({
      type: "updateState",
      url: state.log_file
        ? (state.log_location ?? viewPathUriString(state.log_file))
        : undefined,
    });
  }

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
