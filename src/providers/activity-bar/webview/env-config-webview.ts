import "./vscode-controls.css";
import "./env-config-webview.css";

import { EnvConfiguration } from "../env-config-inspect-provider";

import {
  restoreInputState,
  restoreSelectState,
  setEnvWhenKeyup,
  setEnvWhenValueChanged,
} from "./webview-utils";
import { showProviderHelp } from "./env-utils-model";
import { initEnv } from "./env-utils";

const attachListeners = (vscode: any) => {
  setEnvWhenKeyup(vscode, "max-connections", "maxConnections");
  setEnvWhenValueChanged(vscode, "max-connections", "maxConnections");
  setEnvWhenKeyup(vscode, "max-retries", "maxRetries");
  setEnvWhenValueChanged(vscode, "max-retries", "maxRetries");
  setEnvWhenKeyup(vscode, "timeout", "timeout");
  setEnvWhenValueChanged(vscode, "timeout", "timeout");

  setEnvWhenKeyup(vscode, "log-dir", "logDir");
  setEnvWhenValueChanged(vscode, "log-level", "logLevel");
};

const restoreEnv = (vscode: any, config: EnvConfiguration) => {
  restoreSelectState("provider", config.provider);
  restoreInputState("model", config.model);
  restoreInputState("model-base-url", config.modelBaseUrl);

  restoreInputState("max-connections", config.maxConnections);
  restoreInputState("max-retries", config.maxRetries);
  restoreInputState("timeout", config.timeout);

  restoreInputState("log-dir", config.logDir);
  restoreSelectState("log-level", config.logLevel);

  showProviderHelp(vscode);
};

initEnv(attachListeners, restoreEnv);
