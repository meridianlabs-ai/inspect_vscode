import { ExtensionContext, window } from "vscode";
import { InspectConfigurationProvider } from "./env-config-inspect-provider";
import { activateTaskOutline } from "./task-outline-provider";
import { InspectEvalManager } from "../inspect/inspect-eval";
import { ActiveTaskManager } from "../active-task/active-task-provider";
import { WorkspaceTaskManager } from "../workspace/workspace-task-provider";
import { WorkspaceEnvManager } from "../workspace/workspace-env-provider";
import { WorkspaceStateManager } from "../workspace/workspace-state-provider";
import { TaskConfigurationProvider } from "./task-config-provider";
import {
  DebugConfigTaskCommand,
  RunConfigTaskCommand,
} from "./task-config-commands";
import { InspectViewManager } from "../logview/logview-view";
import { activateLogListing } from "./log-listing/log-listing-provider";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { OutputWatcher } from "../../core/package/output-watcher";
import { end, start } from "../../core/log";
import { PackageManager } from "../../core/package/manager";

export async function activateActivityBar(
  inspectManager: PackageManager,
  inspectEvalMgr: InspectEvalManager,
  inspectLogviewManager: InspectViewManager,
  activeTaskManager: ActiveTaskManager,
  workspaceTaskMgr: WorkspaceTaskManager,
  workspaceStateMgr: WorkspaceStateManager,
  workspaceEnvMgr: WorkspaceEnvManager,
  inspectViewServer: InspectViewServer,
  outputWatcher: OutputWatcher,
  context: ExtensionContext
) {
  start("Log Listing");
  const [logsCommands, logsDispose] = await activateLogListing(
    context,
    workspaceEnvMgr,
    inspectViewServer,
    outputWatcher
  );
  context.subscriptions.push(...logsDispose);
  end("Log Listing");

  start("Task Outline");
  const [outlineCommands, treeDataProvider] = await activateTaskOutline(
    context,
    inspectEvalMgr,
    workspaceTaskMgr,
    activeTaskManager,
    inspectManager,
    inspectLogviewManager
  );
  context.subscriptions.push(treeDataProvider);
  end("Task Outline");

  const envProvider = new InspectConfigurationProvider(
    context.extensionUri,
    workspaceEnvMgr,
    workspaceStateMgr,
    inspectManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      InspectConfigurationProvider.viewType,
      envProvider
    )
  );

  const taskConfigProvider = new TaskConfigurationProvider(
    context.extensionUri,
    workspaceStateMgr,
    activeTaskManager,
    inspectManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      TaskConfigurationProvider.viewType,
      taskConfigProvider
    )
  );
  const taskConfigCommands = [
    new RunConfigTaskCommand(activeTaskManager, inspectEvalMgr),
    new DebugConfigTaskCommand(activeTaskManager, inspectEvalMgr),
  ];

  return [...outlineCommands, ...taskConfigCommands, ...logsCommands];
}
