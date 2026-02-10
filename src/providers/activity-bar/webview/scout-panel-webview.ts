import "./vscode-controls.css";
import "./scout-panel-webview.css";

import {
  provideVSCodeDesignSystem,
  allComponents,
} from "@vscode/webview-ui-toolkit";

// Declare the acquireVsCodeApi function
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

function init() {
  // Load the VS Code design system
  provideVSCodeDesignSystem().register(allComponents);

  // Get access to the VS Code API
  const vscode = acquireVsCodeApi();

  // Handle messages from the extension
  window.addEventListener("message", (e: MessageEvent) => {
    const message = e.data;
    switch (message.type) {
      case "initialize":
        showPanel();
        break;
      case "noPackage":
        showNoPackage();
        break;
    }
  });

  // Set up navigation link click handlers
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach(link => {
    link.addEventListener("click", (e: Event) => {
      e.preventDefault();
      const target = (e.currentTarget as HTMLElement).dataset.target;
      if (target) {
        vscode.postMessage({
          command: "navigate",
          target,
        });
      }
    });
  });

  // Request initial data
  vscode.postMessage({ command: "initialize" });
}

function showPanel() {
  const panel = document.getElementById("scout-panel");
  const noPackage = document.getElementById("no-package");

  panel?.classList.remove("hidden");
  noPackage?.classList.add("hidden");
}

function showNoPackage() {
  const panel = document.getElementById("scout-panel");
  const noPackage = document.getElementById("no-package");

  panel?.classList.add("hidden");
  noPackage?.classList.remove("hidden");
}

// Initialize when the page loads
window.addEventListener("load", init);
