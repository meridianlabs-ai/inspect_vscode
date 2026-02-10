import {
  Disposable,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  commands,
} from "vscode";

import { getNonce } from "../../core/nonce";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { headHTML } from "./env-config-provider";

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
    const scriptUri = webview.asWebviewUri(
      Uri.joinPath(this.extensionUri_, "out", "scout-panel-webview.js")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      ${headHTML(nonce, webview, this.extensionUri_)}
      <body>
        <section class="component-container">
          <div id="scout-panel" class="hidden">
            <div class="nav-links">
              <a class="nav-link" data-target="project">
                <i class="codicon codicon-settings-gear"></i>
                <div class="nav-text">
                  <span class="nav-title">Project Config</span>
                  <span class="nav-description">Edit project settings</span>
                </div>
              </a>
              <a class="nav-link" data-target="transcripts">
                <i class="codicon codicon-file-text"></i>
                <div class="nav-text">
                  <span class="nav-title">Transcripts</span>
                  <span class="nav-description">Browse transcripts</span>
                </div>
              </a>
              <a class="nav-link" data-target="scans">
                <i class="codicon codicon-graph"></i>
                <div class="nav-text">
                  <span class="nav-title">Scans</span>
                  <span class="nav-description">View scan results</span>
                </div>
              </a>
              <a class="nav-link" data-target="validations">
                <i class="codicon codicon-checklist"></i>
                <div class="nav-text">
                  <span class="nav-title">Validations</span>
                  <span class="nav-description">Review validation sets</span>
                </div>
              </a>
            </div>
          </div>
          <div id="no-package" class="hidden">
            <p>Scout is not installed.</p>
          </div>
        </section>
        <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
      </body>
      </html>`;
  }

  public dispose() {
    for (const d of this.disposables_) {
      d.dispose();
    }
  }
}
