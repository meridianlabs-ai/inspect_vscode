import "./vscode-controls.css";
import "./env-config-webview.css";
import "./scout-env-config-webview.css";

import { EnvConfiguration } from "../env-config-provider";

import { restoreInputState, restoreSelectState } from "./webview-utils";
import { showProviderHelp } from "./env-utils-model";
import { initEnv } from "./env-utils";

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

initEnv(restoreEnv);
