import { Uri, Webview } from "vscode";
import { getNonce } from "../../core/nonce";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { PackageManager } from "../../core/package/manager";

import {
  EnvConfigManager,
  EnvConfigurationProvider,
  headHTML,
  modelPickerHTML,
} from "./env-config-provider";
import { kScoutEnvValues } from "../scout/scout-constants";

export interface ScoutConfiguration {
  provider?: string;
  model?: string;
  modelBaseUrl?: string;
  scanResultsDir?: string;
}

class ScoutConfig implements EnvConfigManager<ScoutConfiguration> {
  public defaultConfig(): ScoutConfiguration {
    return {};
  }
  public configToEnv(config: ScoutConfiguration): Record<string, string> {
    const env: Record<string, string> = {};
    if (config.provider && config.model) {
      env[kScoutEnvValues.providerModel] = `${config.provider}/${config.model}`;
    } else {
      env[kScoutEnvValues.providerModel] = "";
    }
    env[kScoutEnvValues.modelBaseUrl] = config.modelBaseUrl || "";
    env[kScoutEnvValues.scanResultsDir] = config.scanResultsDir || "";

    return env;
  }
  public envToConfig(envManager: WorkspaceEnvManager): ScoutConfiguration {
    const config: ScoutConfiguration = {};
    const env = envManager.getValues();
    const providerModelStr = env[kScoutEnvValues.providerModel];
    if (providerModelStr) {
      const providerModelParts = providerModelStr.split("/");
      if (providerModelParts.length > 1) {
        config.provider = providerModelParts[0];
        config.model = providerModelParts.slice(1).join("/");
      } else {
        config.provider = providerModelStr;
      }
    } else {
      config.provider = "";
      config.model = "";
    }

    const modelBaseUrl = env[kScoutEnvValues.modelBaseUrl];
    if (modelBaseUrl) {
      config.modelBaseUrl = modelBaseUrl;
    }

    const scanResultsDir = env[kScoutEnvValues.scanResultsDir];
    if (scanResultsDir) {
      config.scanResultsDir = scanResultsDir;
    }

    return config;
  }
  public setConfiguration(
    key: string,
    value: string,
    state: ScoutConfiguration
  ) {
    switch (key) {
      case "provider":
        state.provider = value;
        break;
      case "model":
        state.model = value;
        break;
      case "modelBaseUrl":
        state.modelBaseUrl = value;
        break;
      case "scanResultsDir":
        state.scanResultsDir = value;
    }
  }
}

export class ScoutConfigurationProvider extends EnvConfigurationProvider<ScoutConfiguration> {
  public static readonly viewType = "inspect_ai.scout-env-configuration-view";

  constructor(
    extensionUri: Uri,
    envManager: WorkspaceEnvManager,
    stateManager: WorkspaceStateManager,
    scoutManager: PackageManager
  ) {
    super(
      extensionUri,
      envManager,
      new ScoutConfig(),
      stateManager,
      scoutManager,
      "scanResultsDir",
      "inspect.scanListingUpdate"
    );
  }

  protected override htmlForWebview(webview: Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      Uri.joinPath(this.extensionUri_, "out", "scout-env-config-webview.js")
    );

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();

    return `<!DOCTYPE html>
              <html lang="en">
              ${headHTML(nonce, webview, this.extensionUri_)}
              <body>
              <section class="component-container">
                <form id="configuration-controls" class="hidden">
                <vscode-panels>
                  <vscode-panel-tab id="tab-1">Model</vscode-panel-tab>
                  <vscode-panel-view id="view-1">

                    <div class="group rows full-width">
                      ${modelPickerHTML()}                 
                    </div>
                  </vscode-panel-view>
                </vscode-panels>
                </form>
              </section>
            
              <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
              </body>
              </html>`;
  }
}
