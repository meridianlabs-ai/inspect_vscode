import { ExtensionContext, Uri, ViewColumn } from "vscode";

import {
  InspectWebview,
  InspectWebviewManager,
} from "../../components/webview";
import { HostWebviewPanel } from "../../hooks";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { RouteMessage, viewRouteMessage } from "./scanview-message";
import { ScanviewPanel } from "./scanview-panel";
import { scoutViewPath } from "../../scout/props";
import { ScoutViewServer } from "../scout/scout-view-server";
import { ListingMRU } from "../../core/listing-mru";

const kScanViewId = "inspect.scanview";

export class ScoutViewManager {
  constructor(private readonly webViewManager_: ScoutViewWebviewManager) {}

  public async showScoutView(
    route?: "scans" | "transcripts" | "validation" | "project"
  ) {
    // Show the log view for the log dir (or the workspace)
    await this.webViewManager_.showScoutRoute(
      viewRouteMessage(route ?? "scans"),
      "activate"
    );
  }

  public viewColumn() {
    return this.webViewManager_.viewColumn();
  }
}

export class ScoutViewWebviewManager extends InspectWebviewManager<
  ScoutViewWebview,
  ScoutViewServer,
  RouteMessage
> {
  constructor(
    scoutManager: PackageManager,
    server: ScoutViewServer,
    context: ExtensionContext
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
      ScoutViewWebview
    );
  }

  public async showScoutRoute(
    route: RouteMessage,
    activation?: "open" | "activate"
  ) {
    switch (activation) {
      case "open":
        this.showViewAndGotoRoute(route, activation);
        break;
      case "activate":
        if (!this.isVisible()) {
          this.showViewAndGotoRoute(route, activation);
        } else {
          this.updateViewRouteState(route);
          await this.activeView_?.update(route);
        }
        break;
      default:
        // No activation, just refresh this in the background
        if (this.isVisible()) {
          this.updateViewRouteState(route);
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

  public showViewAndGotoRoute(
    route: RouteMessage,
    activation?: "open" | "activate"
  ) {
    // Update the view state
    this.updateViewRouteState(route);

    // Ensure that we send the state once the view is loaded
    this.setOnShow(() => {
      this.updateVisibleView().catch(() => {});
    });

    // If the view is closed, clear the state
    this.setOnClose(() => {
      this.lastRouteMessage_ = undefined;
    });

    // Actually reveal or show the webview
    if (this.activeView_) {
      if (activation === "activate") {
        this.revealWebview(activation !== "activate");
      } else {
        this.updateViewRouteState(route);
      }
    } else {
      if (activation) {
        this.showWebview(route, {
          preserveFocus: activation !== "activate",
          viewColumn: ViewColumn.One,
        });
      }
    }

    // TODO: there is probably a better way to handle this
    this.activeView_?.setManager(this);
  }

  private async updateVisibleView() {
    if (this.activeView_ && this.isVisible() && this.lastRouteMessage_) {
      await this.activeView_.update(this.lastRouteMessage_);
    }
  }

  private updateViewRouteState(route: RouteMessage) {
    if (
      !this.lastRouteMessage_ ||
      this.lastRouteMessage_.route !== route.route
    ) {
      this.lastRouteMessage_ = route;
    }
  }

  private lastRouteMessage_?: RouteMessage = undefined;
}

class ScoutViewWebview extends InspectWebview<RouteMessage> {
  private readonly scanviewPanel_: ScanviewPanel;

  public constructor(
    context: ExtensionContext,
    server: ScoutViewServer,
    message: RouteMessage,
    webviewPanel: HostWebviewPanel
  ) {
    super(context, webviewPanel);

    this.scanviewPanel_ = new ScanviewPanel(webviewPanel, context, server);
    this._register(this.scanviewPanel_);

    this.show(message);
  }

  public setManager(manager: ScoutViewWebviewManager) {
    if (this._manager !== manager) {
      this._manager = manager;
    }
  }
  _manager: ScoutViewWebviewManager | undefined;

  public async update(message: RouteMessage) {
    await this._webviewPanel.webview.postMessage(message);
  }

  protected getHtml(message: RouteMessage): string {
    return this.scanviewPanel_.getHtml(message);
  }
}

const kScanResultsMruKey = "inspect_ai.scan-results-listing-mru";

export class ScanResultsListingMRU extends ListingMRU {
  constructor(context_: ExtensionContext) {
    super(kScanResultsMruKey, context_);
  }
}
