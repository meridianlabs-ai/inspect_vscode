import { debounce } from "lodash";
import {
  commands,
  Disposable,
  env,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
} from "vscode";

import { getNonce } from "../../core/nonce";
import {
  PackageChangedEvent,
  PackageManager,
} from "../../core/package/manager";
import { inspectVersion } from "../../inspect";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";

import { PanelResources } from "./panel-html";

export const kActiveTaskChanged = "activeTaskChanged";
export const kInitialize = "initialize";
export const kEnvChanged = "envChanged";

export type SetEnvCommand = {
  command: "setEnvValue";
  default: string;
  value: string;
} & Record<string, string>;

export type InitCommand = {
  command: "initialize";
};

export type OpenUrlCommand = {
  command: "openUrl";
  url: string;
};

export interface EnvConfig {
  provider?: string;
}

export interface EnvConfigManager<T extends EnvConfig> {
  defaultConfig: () => T;
  configToEnv: (config: T) => Record<string, string>;
  envToConfig: (envMgr: WorkspaceEnvManager) => T;
  setConfiguration: (key: string, value: string, state: T) => void;
}

export class EnvConfigurationProvider<
  T extends EnvConfig,
> implements WebviewViewProvider {
  constructor(
    protected readonly extensionUri_: Uri,
    protected readonly envManager_: WorkspaceEnvManager,
    private readonly envConfigManager_: EnvConfigManager<T>,
    private readonly stateManager_: WorkspaceStateManager,
    private readonly packageManager_: PackageManager,
    private readonly updateListingVar_: string,
    private readonly updateListingCommand_: string
  ) {
    this.env = envConfigManager_.defaultConfig();
  }
  private env: T;

  public resolveWebviewView(webviewView: WebviewView) {
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this.extensionUri_],
    };

    webviewView.webview.html = this.htmlForWebview(webviewView.webview);

    // Process UI messages
    webviewView.webview.onDidReceiveMessage(
      async (data: SetEnvCommand | InitCommand | OpenUrlCommand) => {
        const command = data.command;
        switch (command) {
          case "initialize": {
            if (inspectVersion() === null) {
              await noPackageMsg();
            } else {
              await initMsg();
            }
            break;
          }
          case "setEnvValue": {
            // Set the value
            this.envConfigManager_.setConfiguration(
              data.default,
              data.value,
              this.env
            );

            // Special case for provider, potentially restoring the
            // previously used model
            let updateWebview = false;
            if (data.default === "provider") {
              const modelState = this.stateManager_.getModelState(data.value);
              this.envConfigManager_.setConfiguration(
                "model",
                modelState.lastModel || "",
                this.env
              );
              updateWebview = true;
            }

            // Save the most recently used model for this provider
            if (this.env.provider && data.default === "model") {
              const modelState = this.stateManager_.getModelState(
                this.env.provider
              );
              modelState.lastModel = data.value;
              await this.stateManager_.setModelState(
                this.env.provider,
                modelState
              );
            }

            // Save the env
            this.envManager_.setValues(
              this.envConfigManager_.configToEnv(this.env)
            );

            if (updateWebview) {
              await webviewView.webview.postMessage({
                type: kEnvChanged,
                message: {
                  env: this.env,
                },
              });
            }

            if (data.default === this.updateListingVar_) {
              // The log dir was changed, update the task tree if needed
              await debounce(
                async () => {
                  await commands.executeCommand(this.updateListingCommand_);
                },
                500,
                { leading: false, trailing: true }
              )();
            }

            break;
          }
          case "openUrl":
            await env.openExternal(Uri.parse(data.url));
            break;
        }
      }
    );

    const initMsg = async () => {
      // Merge current state
      this.env = this.envConfigManager_.envToConfig(this.envManager_);

      // Send the state over
      await webviewView.webview.postMessage({
        type: kInitialize,
        message: {
          env: this.env,
        },
      });
    };

    const noPackageMsg = async () => {
      await webviewView.webview.postMessage({
        type: "noPackage",
      });
    };

    // Update the panel if the environment changes
    this.disposables_.push(
      this.envManager_.onEnvironmentChanged(async () => {
        this.env = this.envConfigManager_.envToConfig(this.envManager_);
        await webviewView.webview.postMessage({
          type: kEnvChanged,
          message: {
            env: this.env,
          },
        });
      })
    );

    // If the interpreter changes, refresh the tasks
    this.disposables_.push(
      this.packageManager_.onPackageChanged(async (e: PackageChangedEvent) => {
        if (e.available) {
          await initMsg();
        } else {
          await noPackageMsg();
        }
      })
    );

    // Attach a listener to clean up resources when the webview is disposed
    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }

  protected htmlForWebview(_webview: Webview): string {
    return "";
  }

  private disposables_: Disposable[] = [];
  private dispose() {
    this.disposables_.forEach((disposable) => {
      disposable.dispose();
    });
  }
}

export function panelResources(
  webview: Webview,
  extensionUri: Uri,
  script: string
): PanelResources {
  const uri = (...segments: string[]) =>
    webview.asWebviewUri(Uri.joinPath(extensionUri, ...segments)).toString();
  return {
    cspSource: webview.cspSource,
    nonce: getNonce(),
    scriptUri: uri("out", script),
    codiconCssUri: uri("assets", "www", "codicon", "codicon.css"),
    codiconFontUri: uri("assets", "www", "codicon", "codicon.ttf"),
  };
}
