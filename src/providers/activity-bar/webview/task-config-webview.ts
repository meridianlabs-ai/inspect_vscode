import "./vscode-controls.css";
import "./task-config-webview.css";
import "./components";

import { DocumentState } from "../../workspace/workspace-state-provider";

import {
  isMessageFromHost,
  restoreInputState,
  setControlsVisible,
  showEmptyPanel,
  whenChanged,
} from "./webview-utils";

// Declare the acquireVsCodeApi function to tell TypeScript about it
declare function acquireVsCodeApi(): any;

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Process messages
window.addEventListener("message", (e) => {
  if (!isMessageFromHost(e)) {
    return;
  }
  switch (e.data.type) {
    case "initialize":
      showEmptyPanel("No task selected", "configuration-controls");
      break;

    case "noPackage":
      showEmptyPanel("Package not installed.", "configuration-controls");
      break;

    case "setActiveTask":
      const placeholderPanel = document.querySelector(".empty-panel");
      if (placeholderPanel) {
        placeholderPanel.remove();
      }
      restoreState(e.data.state);
      attachListeners();

      const taskArgContainer = document.getElementById("task-args");
      if (taskArgContainer) {
        taskArgContainer.replaceChildren();
        if (e.data.task.activeTask?.params) {
          let count = 1;
          for (const param of e.data.task.activeTask.params) {
            const id = `task-param-${count}`;
            const label = document.createElement("vscode-label");
            label.htmlFor = id;
            const labelText = document.createElement("span");
            labelText.classList.add("normal");
            labelText.textContent = param;
            label.appendChild(labelText);
            const textField = document.createElement("vscode-textfield");
            textField.id = id;
            textField.placeholder = "default";
            const paramValue = e.data.state.params?.[param];
            if (paramValue) {
              textField.value = paramValue;
            }
            const field = document.createElement("div");
            field.classList.add("field", "full-width");
            field.append(label, textField);
            taskArgContainer.appendChild(field);
            whenChanged(id, (value) => {
              setStateParam(param, value);
            });
            count++;
          }
          if (e.data.task.activeTask?.params.length === 0) {
            showEmptyPanel(
              "No arguments for this task",
              undefined,
              "task-args"
            );
          }
        }
        setControlsVisible("configuration-controls", true);
      }

      break;
  }
});

// Once loaded, initialize the process
window.addEventListener("load", main);

function restoreState(state?: DocumentState) {
  restoreInputState("epochs", state?.epochs);
  restoreInputState("limit", state?.limit);
  restoreInputState("temperature", state?.temperature);
  restoreInputState("max_tokens", state?.maxTokens);
  restoreInputState("top_p", state?.topP);
  restoreInputState("top_k", state?.topK);
  restoreInputState("sample_ids", state?.sampleIds);
  validateFields();
}

function attachListeners() {
  whenChanged("epochs", (value) => {
    setStateValue("epochs", value);
  });

  whenChanged("limit", (value) => {
    validateFields();
    setStateValue("limit", value);
  });

  whenChanged("temperature", (value) => {
    setStateValue("temperature", value);
  });

  whenChanged("max_tokens", (value) => {
    setStateValue("maxTokens", value);
  });

  whenChanged("top_p", (value) => {
    setStateValue("topP", value);
  });

  whenChanged("top_k", (value) => {
    setStateValue("topK", value);
  });

  whenChanged("sample_ids", (value) => {
    validateFields();
    setStateValue("sampleIds", value);
  });
}

function validateFields() {
  const sampleIdsEl = document.getElementById("sample_ids") as HTMLInputElement;
  const limitEl = document.getElementById("limit") as HTMLInputElement;
  const errorMsgEl = document.getElementById(
    "validation-error"
  ) as HTMLInputElement;

  const conflict = limitEl.value !== "" && sampleIdsEl.value !== "";
  errorMsgEl.innerText = conflict
    ? "Cannot set both limit and sample ids. Please choose one."
    : "";
  errorMsgEl.classList.toggle("hidden", !conflict);
  sampleIdsEl.toggleAttribute("invalid", conflict);
  limitEl.toggleAttribute("invalid", conflict);
}

function main() {
  // Send the initialize message
  vscode.postMessage({
    command: "initialize",
  });
}

function setStateValue(key: string, value: string) {
  vscode.postMessage({
    command: "setStateValue",
    key,
    value,
  });
}

function setStateParam(key: string, value: string) {
  vscode.postMessage({
    command: "setStateParam",
    key,
    value,
  });
}
