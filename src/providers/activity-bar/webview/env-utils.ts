import "./vscode-controls.css";
import "./env-config-webview.css";

import {
  fastCombobox,
  fastOption,
  provideFASTDesignSystem,
} from "@microsoft/fast-components";
import {
  allComponents,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";

import { attachModelListeners } from "./env-utils-model";
import { showEmptyPanel } from "./webview-utils";

// Declare the acquireVsCodeApi function to tell TypeScript about it
declare function acquireVsCodeApi(): any;

export function initEnv(
  attachListeners: (vscode: any) => void,
  restoreEnv: (vscode: any, env: any) => void
) {
  // Load the vscode design system
  provideVSCodeDesignSystem().register(allComponents);

  // Use the function to get the VS Code API handle
  provideFASTDesignSystem().register(fastCombobox(), fastOption());

  // Get access to the VS Code API from within the webview context
  const vscode = acquireVsCodeApi();

  // Process messages
  window.addEventListener("message", (e) => {
    switch (e.data.type) {
      case "initialize":
        // Set the env values
        const env = e.data.message.env;
        restoreEnv(vscode, env);

        const controls = document.getElementById("configuration-controls");
        controls?.classList.remove("hidden");

        attachModelListeners(vscode);
        attachListeners(vscode);

        break;
      case "envChanged":
        // Set the state values
        restoreEnv(vscode, e.data.message.env);
        break;

      case "noPackage":
        showEmptyPanel("Package not installed", "configuration-controls");
    }
  });

  function main() {
    // Send the initialize message
    vscode.postMessage({
      command: "initialize",
    });
  }

  // Once loaded, initialize the process
  window.addEventListener("load", main);
}
