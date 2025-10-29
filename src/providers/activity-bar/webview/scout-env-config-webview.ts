import "./vscode-controls.css";
import "./env-config-webview.css";
import "./scout-env-config-webview.css";

import { ScoutConfiguration } from "../env-config-scout-provider";

import { restoreInputState, restoreSelectState } from "./webview-utils";
import { showProviderHelp } from "./env-utils-model";
import { initEnv } from "./env-utils";

const attachListeners = (vscode: any) => {
  //
};

const restoreEnv = (vscode: any, config: ScoutConfiguration) => {
  restoreSelectState("provider", config.provider);
  restoreInputState("model", config.model);
  restoreInputState("model-base-url", config.modelBaseUrl);

  showProviderHelp(vscode);
};

initEnv(attachListeners, restoreEnv);
