import "./vscode-controls.css";
import "./env-config-webview.css";
import "./scout-env-config-webview.css";

import { ScoutConfiguration } from "../env-config-scout-provider";

import {
  restoreInputState,
  restoreSelectState,
  setEnvWhenKeyup,
  setEnvWhenValueChanged,
} from "./webview-utils";
import { showProviderHelp } from "./env-utils-model";
import { initEnv } from "./env-utils";

const attachListeners = (vscode: any) => {
  setEnvWhenKeyup(vscode, "scan-max-connections", "scanMaxConnections");
  setEnvWhenValueChanged(vscode, "scan-max-connections", "scanMaxConnections");

  setEnvWhenKeyup(vscode, "scan-max-transcripts", "scanMaxTranscripts");
  setEnvWhenValueChanged(vscode, "scan-max-transcripts", "scanMaxTranscripts");

  setEnvWhenKeyup(vscode, "scan-max-processes", "scanMaxProcesses");
  setEnvWhenValueChanged(vscode, "scan-max-processes", "scanMaxProcesses");

  setEnvWhenKeyup(vscode, "scan-transcripts", "scanTranscripts");
  setEnvWhenValueChanged(vscode, "scan-transcripts", "scanTranscripts");

  setEnvWhenKeyup(vscode, "scan-results", "scanResults");
  setEnvWhenValueChanged(vscode, "scan-results", "scanResults");

  setEnvWhenKeyup(vscode, "scan-limit", "scanLimit");
  setEnvWhenValueChanged(vscode, "scan-limit", "scanLimit");

  setEnvWhenKeyup(vscode, "scan-shuffle", "scanShuffle");
  setEnvWhenValueChanged(vscode, "scan-shuffle", "scanShuffle");
};

const restoreEnv = (vscode: any, config: ScoutConfiguration) => {
  restoreSelectState("provider", config.provider);
  restoreInputState("model", config.model);
  restoreInputState("model-base-url", config.modelBaseUrl);

  restoreInputState("scan-max-connections", config.scanMaxConnections);
  restoreInputState("scan-max-transcripts", config.scanMaxTranscripts);
  restoreInputState("scan-max-processes", config.scanMaxProcesses);

  restoreInputState("scan-transcripts", config.scanTranscripts);
  restoreInputState("scan-results", config.scanResults);

  restoreInputState("scan-limit", config.scanLimit);
  restoreInputState("scan-shuffle", config.scanShuffle);

  showProviderHelp(vscode);
};

initEnv(attachListeners, restoreEnv);
