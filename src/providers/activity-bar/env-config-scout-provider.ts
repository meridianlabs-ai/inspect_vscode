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
  scanTranscripts?: string;
  scanLimit?: string;
  scanShuffle?: string;
  scanResults?: string;
  scanMaxTranscripts?: string;
  scanMaxProcesses?: string;
  scanMaxConnections?: string;
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
    env[kScoutEnvValues.scanTranscripts] = config.scanTranscripts || "";
    env[kScoutEnvValues.scanLimit] = config.scanLimit || "";
    env[kScoutEnvValues.scanShuffle] = config.scanShuffle || "";
    env[kScoutEnvValues.scanResults] = config.scanResults || "";
    env[kScoutEnvValues.scanMaxTranscripts] = config.scanMaxTranscripts || "";
    env[kScoutEnvValues.scanMaxProcesses] = config.scanMaxProcesses || "";
    env[kScoutEnvValues.scanMaxConnections] = config.scanMaxConnections || "";

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

    const scanTranscripts = env[kScoutEnvValues.scanTranscripts];
    if (scanTranscripts) {
      config.scanTranscripts = scanTranscripts;
    }
    const scanLimit = env[kScoutEnvValues.scanLimit];
    if (scanLimit) {
      config.scanLimit = scanLimit;
    }
    const scanShuffle = env[kScoutEnvValues.scanShuffle];
    if (scanShuffle) {
      config.scanShuffle = scanShuffle;
    }
    const scanResults = env[kScoutEnvValues.scanResults];
    if (scanResults) {
      config.scanResults = scanResults;
    }

    const scanMaxTranscripts = env[kScoutEnvValues.scanMaxTranscripts];
    if (scanMaxTranscripts) {
      config.scanMaxTranscripts = scanMaxTranscripts;
    }
    const scanMaxProcesses = env[kScoutEnvValues.scanMaxProcesses];
    if (scanMaxProcesses) {
      config.scanMaxProcesses = scanMaxProcesses;
    }
    const scanMaxConnections = env[kScoutEnvValues.scanMaxConnections];
    if (scanMaxConnections) {
      config.scanMaxConnections = scanMaxConnections;
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
      case "scanResults":
        state.scanResults = value;
        break;
      case "scanTranscripts":
        state.scanTranscripts = value;
        break;
      case "scanMaxTranscripts":
        state.scanMaxTranscripts = value;
        break;
      case "scanMaxProcesses":
        state.scanMaxProcesses = value;
        break;
      case "scanMaxConnections":
        state.scanMaxConnections = value;
        break;
      case "scanLimit":
        state.scanLimit = value;
        break;
      case "scanShuffle":
        state.scanShuffle = value;
        break;
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
      "scanResults",
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

    // See if we need a placeholder for transcripts
    const envValues = this.envManager_.getValues();
    const transcriptsPlaceholder = envValues["SCOUT_SCAN_TRANSCRIPTS"]
      ? ""
      : envValues["INSPECT_LOG_DIR"] || "./logs";

    return `<!DOCTYPE html>
              <html lang="en">
              ${headHTML(nonce, webview, this.extensionUri_)}
              <body>
              <section class="component-container">
                <form id="configuration-controls" class="hidden">
                <div class="group rows full-width">
                  <vscode-text-field placeholder="${transcriptsPlaceholder}" id="scan-transcripts" class="full-width">Transcripts</vscode-text-field>
                  <div class="cols control-column full-width">
                    <vscode-text-field id="scan-limit" size="5" placeholder="" min="1">Limit</vscode-text-field>
                    <vscode-text-field id="scan-shuffle" size="5" placeholder="" min="1">Shuffle</vscode-text-field>
                  </div>
                  <vscode-text-field placeholder="./scans" id="scan-results" class="full-width">Scan Results</vscode-text-field>
                  <div class="cols control-column full-width">
                    <vscode-text-field id="scan-max-transcripts" size="3" placeholder="" min="1">Max Transcripts</vscode-text-field>
                    <vscode-text-field id="scan-max-processes" size="3" placeholder="" min="1">Max Processes</vscode-text-field>
                    <vscode-text-field id="scan-max-connections" size="3" placeholder="" min="1">Max Connections</vscode-text-field>
                    </div>
                  ${modelPickerHTML("Scanner Model")}
                </div>
                </form>
              </section>

              <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
              </body>
              </html>`;
  }
}
