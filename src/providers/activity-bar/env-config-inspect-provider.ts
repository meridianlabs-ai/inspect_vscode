import { Uri, Webview } from "vscode";
import { getNonce } from "../../core/nonce";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { kInspectEnvValues } from "../inspect/inspect-constants";
import { PackageManager } from "../../core/package/manager";

import {
  EnvConfigManager,
  EnvConfigurationProvider,
  headHTML,
  modelPickerHTML,
} from "./env-config-provider";

export interface EnvConfiguration {
  provider?: string;
  model?: string;
  maxConnections?: string;
  maxRetries?: string;
  timeout?: string;
  logDir?: string;
  logLevel?: string;
  modelBaseUrl?: string;
}

class InspectConfig implements EnvConfigManager<EnvConfiguration> {
  public defaultConfig(): EnvConfiguration {
    return {};
  }
  public configToEnv(config: EnvConfiguration): Record<string, string> {
    const env: Record<string, string> = {};
    if (config.provider && config.model) {
      env[kInspectEnvValues.providerModel] =
        `${config.provider}/${config.model}`;
    } else {
      env[kInspectEnvValues.providerModel] = "";
    }

    env[kInspectEnvValues.logLevel] = config.logLevel || "";
    env[kInspectEnvValues.logDir] = config.logDir || "";
    env[kInspectEnvValues.connections] = config.maxConnections || "";
    env[kInspectEnvValues.retries] = config.maxRetries || "";
    env[kInspectEnvValues.timeout] = config.timeout || "";
    env[kInspectEnvValues.modelBaseUrl] = config.modelBaseUrl || "";

    return env;
  }
  public envToConfig(envManager: WorkspaceEnvManager): EnvConfiguration {
    const config: EnvConfiguration = {};
    const env = envManager.getValues();
    const providerModelStr = env[kInspectEnvValues.providerModel];
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

    const logLevel = env[kInspectEnvValues.logLevel];
    if (logLevel) {
      config.logLevel = logLevel;
    }

    const logDir = env[kInspectEnvValues.logDir];
    if (logDir) {
      config.logDir = logDir;
    }

    const maxConnections = env[kInspectEnvValues.connections];
    if (maxConnections) {
      config.maxConnections = maxConnections;
    }

    const maxRetries = env[kInspectEnvValues.retries];
    if (maxRetries) {
      config.maxRetries = maxRetries;
    }

    const timeout = env[kInspectEnvValues.timeout];
    if (timeout) {
      config.timeout = timeout;
    }

    const modelBaseUrl = env[kInspectEnvValues.modelBaseUrl];
    if (modelBaseUrl) {
      config.modelBaseUrl = modelBaseUrl;
    }

    return config;
  }
  public setConfiguration(key: string, value: string, state: EnvConfiguration) {
    switch (key) {
      case "provider":
        state.provider = value;
        break;
      case "model":
        state.model = value;
        break;
      case "logDir":
        state.logDir = value;
        break;
      case "logLevel":
        state.logLevel = value;
        break;
      case "maxConnections":
        state.maxConnections = value;
        break;
      case "maxRetries":
        state.maxRetries = value;
        break;
      case "timeout":
        state.timeout = value;
        break;
      case "modelBaseUrl":
        state.modelBaseUrl = value;
        break;
    }
  }
}

export class InspectConfigurationProvider extends EnvConfigurationProvider<EnvConfiguration> {
  public static readonly viewType = "inspect_ai.env-configuration-view";

  constructor(
    extensionUri: Uri,
    envManager: WorkspaceEnvManager,
    stateManager: WorkspaceStateManager,
    inspectManager: PackageManager
  ) {
    super(
      extensionUri,
      envManager,
      new InspectConfig(),
      stateManager,
      inspectManager,
      "logDir",
      "inspect.logListingUpdate"
    );
  }

  protected override htmlForWebview(webview: Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      Uri.joinPath(this.extensionUri_, "out", "env-config-webview.js")
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
                  <vscode-panel-tab id="tab-2">Logging</vscode-panel-tab>
                  <vscode-panel-view id="view-1">

                    <div class="group rows full-width" >
                      ${modelPickerHTML()}
                      <div class="cols control-column full-width">
                        <vscode-text-field id="max-connections" size="3" placeholder="default" min="1">Connections</vscode-text-field>
                        <vscode-text-field id="max-retries" size="3" placeholder="default" min="1">Retries</vscode-text-field>
                        <vscode-text-field id="timeout" size="3" placeholder="default" min="1">Timeout</vscode-text-field>
                      </div>                      
                    </div>
                  </vscode-panel-view>
                  <vscode-panel-view id="view-2">
                    <div class="rows full-width">
                      <div class="cols full-width">
                        <vscode-text-field placeholder="default" id="log-dir" size="16" class="full-width"
                          >Log Directory</vscode-text-field
                        >
                        
                        <div class="dropdown-container full-width">
                          <label for="provider">Log Level</label>  
                          <vscode-dropdown id="log-level" position="below" class="full-width">
                            <vscode-option value="">default</vscode-option>
                            <vscode-option value="debug">debug</vscode-option>
                            <vscode-option value="trace">trace</vscode-option>
                            <vscode-option value="http">http</vscode-option>
                            <vscode-option value="info">info</vscode-option>
                            <vscode-option value="warning" selected="true">warning</vscode-option>
                            <vscode-option value="error">error</vscode-option>
                            <vscode-option value="critical">critical</vscode-option>
                          </vscode-dropdown>
                        </div>
                      </div>
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
