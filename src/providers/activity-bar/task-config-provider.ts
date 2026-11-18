import { basename } from "path";

import {
  commands,
  Disposable,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
} from "vscode";

import { DocumentTaskInfo } from "../../components/task";
import { PackageManager } from "../../core/package/manager";
import { inspectVersion } from "../../inspect";
import {
  ActiveTaskChangedEvent,
  ActiveTaskManager,
} from "../active-task/active-task-provider";
import {
  DocumentState,
  WorkspaceStateManager,
} from "../workspace/workspace-state-provider";

import { panelResources } from "./env-config-provider";
import { panelDocument, taskConfigBody } from "./panel-html";

export type SetActiveTaskCommand = {
  type: "setActiveTask";
  task: DocumentTaskInfo;
  state: DocumentState;
} & Record<string, unknown>;

export type SetStateCmd = {
  command: "setStateValue";
  key: string;
  value: string;
};

export type SetStateParamCmd = {
  command: "setStateParam";
  key: string;
  value: string;
};

export type NoInspectCmd = {
  command: "noPackage";
};

export class TaskConfigurationProvider implements WebviewViewProvider {
  public static readonly viewType = "inspect_ai.task-configuration";

  constructor(
    private readonly extensionUri_: Uri,
    private readonly stateManager_: WorkspaceStateManager,
    private readonly taskManager_: ActiveTaskManager,
    private readonly inspectManager_: PackageManager
  ) {}

  public async resolveWebviewView(webviewView: WebviewView) {
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this.extensionUri_],
    };

    const noInspectMsg = async () => {
      webviewView.description = "";
      await webviewView.webview.postMessage({
        type: "noPackage",
      });
    };

    const initMsg = async () => {
      await webviewView.webview.postMessage({
        type: "initialize",
      });
    };

    const updateTaskInfo = async (activeTaskInfo?: DocumentTaskInfo) => {
      if (activeTaskInfo) {
        // Remove any task parameters that may have been removed by this update
        await removeStaleTaskParams(activeTaskInfo);

        // Notify the UI
        await postActiveTaskMsg(activeTaskInfo);
      } else {
        webviewView.description = "";
      }
    };

    const removeStaleTaskParams = async (activeTaskInfo: DocumentTaskInfo) => {
      const currentState = this.stateManager_.getTaskState(
        activeTaskInfo.document.fsPath,
        activeTaskInfo.activeTask?.name
      );
      const keysToRemove = Object.keys(currentState.params || {}).filter(
        (key) => {
          return !activeTaskInfo.activeTask?.params.includes(key);
        }
      );
      if (keysToRemove.length > 0) {
        keysToRemove.forEach((key) => {
          if (currentState.params) {
            delete currentState.params[key];
          }
        });
        await this.stateManager_.setTaskState(
          activeTaskInfo.document.fsPath,
          currentState,
          activeTaskInfo.activeTask?.name
        );
      }
    };

    this.disposables_.push(
      this.taskManager_.onActiveTaskChanged(
        async (e: ActiveTaskChangedEvent) => {
          await updateSidebarState(e.activeTaskInfo);
        }
      )
    );

    // If the interpreter changes, refresh the tasks
    this.disposables_.push(
      this.inspectManager_.onPackageChanged(async () => {
        if (inspectVersion() !== null) {
          await initMsg();
          await this.taskManager_.refresh();
        } else {
          await noInspectMsg();
        }
      })
    );

    this.disposables_.push(
      webviewView.onDidChangeVisibility(async () => {
        const activeTask = this.taskManager_.getActiveTaskInfo();
        await updateTaskInfo(activeTask);
      })
    );

    webviewView.webview.html = this.htmlForWebview(webviewView.webview);
    webviewView.title = "Task";

    await initMsg();

    const postActiveTaskMsg = async (activeTaskInfo: DocumentTaskInfo) => {
      // Ignore active task changes that don't include a task (e.g. they are files)
      if (!activeTaskInfo.activeTask || inspectVersion() === null) {
        return;
      }

      const currentState = this.stateManager_.getTaskState(
        activeTaskInfo.document.fsPath,
        activeTaskInfo.activeTask?.name
      );
      await webviewView.webview.postMessage({
        type: "setActiveTask",
        task: activeTaskInfo,
        state: currentState,
      });
      webviewView.description =
        activeTaskInfo.activeTask?.name ||
        basename(activeTaskInfo.document.fsPath);
    };

    this.disposables_.push(
      this.taskManager_.onActiveTaskChanged(async (e) => {
        await updateSidebarState(e.activeTaskInfo);
        await updateTaskInfo(e.activeTaskInfo);
      })
    );

    if (inspectVersion() === null) {
      await noInspectMsg();
    }

    const activeTask = this.taskManager_.getActiveTaskInfo();
    await updateTaskInfo(activeTask);

    // Process UI messages
    webviewView.webview.onDidReceiveMessage(
      async (data: SetStateCmd | SetStateParamCmd) => {
        const activeTask = this.taskManager_.getActiveTaskInfo();
        if (activeTask) {
          const path = activeTask.document.fsPath;
          const currentState = this.stateManager_.getTaskState(
            path,
            activeTask.activeTask?.name
          );
          switch (data.command) {
            case "setStateValue":
              {
                switch (data.key) {
                  case "epochs":
                    currentState["epochs"] = data.value;
                    break;
                  case "limit":
                    currentState["limit"] = data.value;
                    break;
                  case "temperature":
                    currentState["temperature"] = data.value;
                    break;
                  case "maxTokens":
                    currentState["maxTokens"] = data.value;
                    break;
                  case "topP":
                    currentState["topP"] = data.value;
                    break;
                  case "topK":
                    currentState["topK"] = data.value;
                    break;
                  case "sampleIds":
                    currentState["sampleIds"] = data.value;
                    break;
                }
              }
              break;
            case "setStateParam":
              currentState.params = currentState.params || {};
              if (data.value === "") {
                delete currentState.params[data.key];
              } else {
                currentState.params[data.key] = data.value;
              }
              break;
          }
          await this.stateManager_.setTaskState(
            path,
            currentState,
            activeTask.activeTask?.name
          );
        }
      }
    );

    // Attach a listener to clean up resources when the webview is disposed
    webviewView.onDidDispose(() => {
      this.dispose();
    });
  }
  private disposables_: Disposable[] = [];
  private dispose() {
    this.disposables_.forEach((disposable) => {
      disposable.dispose();
    });
  }

  private htmlForWebview(webview: Webview) {
    return panelDocument(
      panelResources(webview, this.extensionUri_, "task-config-webview.js"),
      taskConfigBody()
    );
  }
}

const updateSidebarState = async (taskInfo?: DocumentTaskInfo) => {
  await commands.executeCommand(
    "setContext",
    "inspect_ai.task-configuration.task-active",
    taskInfo !== undefined
  );
};
