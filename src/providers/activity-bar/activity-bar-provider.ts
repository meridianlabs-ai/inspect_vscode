import { ExtensionContext, window } from "vscode";
import { EnvConfigurationProvider } from "./env-config-provider";
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
import { activateScanListing } from "./log-listing/scan-listing-provider";
import { InspectViewServer } from "../inspect/inspect-view-server";
import { InspectLogsWatcher } from "../inspect/inspect-logs-watcher";
import { end, start } from "../../core/log";
import { PackageManager } from "../../core/package/manager";
import { ScoutEnvConfigurationProvider } from "./scout-env-config-provider";

export async function activateActivityBar(
  inspectManager: PackageManager,
  inspectEvalMgr: InspectEvalManager,
  inspectLogviewManager: InspectViewManager,
  activeTaskManager: ActiveTaskManager,
  workspaceTaskMgr: WorkspaceTaskManager,
  workspaceStateMgr: WorkspaceStateManager,
  workspaceEnvMgr: WorkspaceEnvManager,
  inspectViewServer: InspectViewServer,
  logsWatcher: InspectLogsWatcher,
  context: ExtensionContext
) {
  start("Log Listing");
  const [logsCommands, logsDispose] = await activateLogListing(
    context,
    workspaceEnvMgr,
    inspectViewServer,
    logsWatcher
  );
  context.subscriptions.push(...logsDispose);
  end("Log Listing");

  start("Scan Listing");
  const [scansCommands, scansDispose] = await activateScanListing(
    context,
    workspaceEnvMgr,
    inspectViewServer,
    logsWatcher
  );
  context.subscriptions.push(...scansDispose);
  end("Scan Listing");

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

  const envProvider = new EnvConfigurationProvider(
    context.extensionUri,
    workspaceEnvMgr,
    workspaceStateMgr,
    inspectManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      EnvConfigurationProvider.viewType,
      envProvider
    )
  );

  const scoutEnvProvider = new ScoutEnvConfigurationProvider(
    context.extensionUri,
    workspaceEnvMgr,
    workspaceStateMgr,
    inspectManager
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(
      ScoutEnvConfigurationProvider.viewType,
      scoutEnvProvider
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

  return [
    ...outlineCommands,
    ...taskConfigCommands,
    ...logsCommands,
    ...scansCommands,
  ];
}
