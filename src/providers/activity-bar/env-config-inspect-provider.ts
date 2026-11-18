import { Uri, Webview } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { kInspectEnvValues } from "../inspect/inspect-constants";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";

import {
  EnvConfigManager,
  EnvConfigurationProvider,
  panelResources,
} from "./env-config-provider";
import { inspectConfigBody, panelDocument } from "./panel-html";

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
    return panelDocument(
      panelResources(webview, this.extensionUri_, "env-config-webview.js"),
      inspectConfigBody()
    );
  }
}
