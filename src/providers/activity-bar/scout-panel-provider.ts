import {
  commands,
  Disposable,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
} from "vscode";

import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";

import { panelResources } from "./env-config-provider";
import { panelDocument, scoutPanelBody } from "./panel-html";

type NavigateCommand = {
  command: "navigate";
  target: "project" | "transcripts" | "scans" | "validations";
};

type InitCommand = {
  command: "initialize";
};

export class ScoutPanelProvider implements WebviewViewProvider {
  public static readonly viewType = "inspect_ai.scout-env-configuration-view";

  private webviewView_?: WebviewView;
  private disposables_: Disposable[] = [];

  constructor(
    private readonly extensionUri_: Uri,
    private readonly scoutManager_: PackageManager
  ) {}

  public resolveWebviewView(webviewView: WebviewView) {
    // Clean up from any previous resolveWebviewView call
    for (const d of this.disposables_) {
      d.dispose();
    }
    this.disposables_ = [];

    this.webviewView_ = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri_],
    };

    webviewView.webview.html = this.htmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (data: NavigateCommand | InitCommand) => {
        switch (data.command) {
          case "initialize":
            await this.sendInitialize();
            break;
          case "navigate":
            switch (data.target) {
              case "project":
                await commands.executeCommand("inspect.scoutViewProject");
                break;
              case "transcripts":
                await commands.executeCommand("inspect.scoutViewTranscripts");
                break;
              case "scans":
                await commands.executeCommand("inspect.scoutViewScans");
                break;
              case "validations":
                await commands.executeCommand("inspect.scoutViewValidations");
                break;
            }
            break;
        }
      }
    );

    // Handle package availability changes
    this.disposables_.push(
      this.scoutManager_.onPackageChanged(async (e: PackageChangedEvent) => {
        if (e.available) {
          await this.sendInitialize();
        } else {
          await this.sendNoPackage();
        }
      })
    );

    // Cleanup on dispose
    this.disposables_.push(
      webviewView.onDidDispose(() => {
        this.dispose();
      })
    );
  }

  private async sendInitialize() {
    if (!this.webviewView_) {
      return;
    }

    await this.webviewView_.webview.postMessage({
      type: "initialize",
    });
  }

  private async sendNoPackage() {
    if (!this.webviewView_) {
      return;
    }

    await this.webviewView_.webview.postMessage({
      type: "noPackage",
    });
  }

  private htmlForWebview(webview: Webview): string {
    return panelDocument(
      panelResources(webview, this.extensionUri_, "scout-panel-webview.js"),
      scoutPanelBody()
    );
  }

  public dispose() {
    for (const d of this.disposables_) {
      d.dispose();
    }
  }
}
