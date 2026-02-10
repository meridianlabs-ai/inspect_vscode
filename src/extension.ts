import { ExtensionContext, MessageItem, window } from "vscode";

import { Command, CommandManager } from "./core/command";
import { activateCodeLens } from "./providers/codelens/codelens-provider";
import { activateLogview } from "./providers/logview/logview";
import { logviewTerminalLinkProvider } from "./providers/logview/logview-link-provider";
import { InspectSettingsManager } from "./providers/settings/inspect-settings";
import { initializeGlobalSettings } from "./providers/settings/user-settings";
import { activateEvalManager } from "./providers/inspect/inspect-eval";
import { activateActivityBar } from "./providers/activity-bar/activity-bar-provider";
import { activateActiveTaskProvider } from "./providers/active-task/active-task-provider";
import { activateWorkspaceTaskProvider } from "./providers/workspace/workspace-task-provider";
import {
  activateWorkspaceState,
  WorkspaceStateManager,
} from "./providers/workspace/workspace-state-provider";
import {
  activateWorkspaceEnv,
  WorkspaceEnvManager,
} from "./providers/workspace/workspace-env-provider";
import { initPythonInterpreter } from "./core/python";
import { initInspectProps } from "./inspect";
import { activateInspectManager } from "./providers/inspect/inspect-manager";
import { checkActiveWorkspaceFolder } from "./core/workspace";
import { inspectBinPath, inspectVersionDescriptor } from "./inspect/props";
import { activateStatusBar } from "./providers/statusbar";
import { InspectViewServer } from "./providers/inspect/inspect-view-server";
import { OutputWatcher } from "./core/package/output-watcher";
import { activateLogNotify } from "./providers/lognotify";
import { activateOpenLog } from "./providers/openlog";
import { activateProtocolHandler } from "./providers/protocol-handler";
import { activateInspectCommands } from "./providers/inspect/inspect-commands";
import { end, start } from "./core/log";
import { initScoutProps } from "./scout/props";
import { scanviewTerminalLinkProvider } from "./providers/scanview/scanview-link-provider";
import { activateScoutManager } from "./providers/scout/scout-manager";
import { ScoutViewServer } from "./providers/scout/scout-view-server";
import { activateScanview } from "./providers/scanview/scanview";
import { activateScoutActivityBar } from "./providers/activity-bar/scout-activity-bar-provider";
import { activateScoutCodeLens } from "./providers/codelens/scout-codelens-provider";
import { activateScoutScanManager } from "./providers/scout/scout-scan";
import { activateScoutProject } from "./providers/scout/scout-project";
import { activateWorkspaceEnvironment } from "./providers/environment";
import { activateOpenScan } from "./providers/openscan";
import { activateYamlSchemaProvider } from "./providers/yaml/yaml-schema-provider";
import { PackageManager } from "./core/package/manager";

const kInspectMinimumVersion = "0.3.8";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {
  // we don't activate anything if there is no workspace
  if (!checkActiveWorkspaceFolder()) {
    return;
  }

  const commandManager = new CommandManager();

  // init python interpreter
  start("Identifying Python");
  context.subscriptions.push(await initPythonInterpreter());
  end("Identifying Python");

  // init inspect and scout props
  context.subscriptions.push(initInspectProps());
  context.subscriptions.push(initScoutProps());

  // Initialize global settings
  await initializeGlobalSettings();

  // Warn the user if they don't have a recent enough version
  start("Check Inspect");
  void checkInspectVersion();
  end("Check Inspect");

  // Activate the workspacestate manager
  start("Activate Workspace");
  const [stateCommands, stateManager] = activateWorkspaceState(context);
  end("Activate Workspace");

  // For now, create an output channel for env changes
  start("Monitor Workspace Env");
  const workspaceActivationResult = activateWorkspaceEnv();
  const [envComands, workspaceEnvManager] = workspaceActivationResult;
  context.subscriptions.push(workspaceEnvManager);
  end("Monitor Workspace Env");

  // Initialize the protocol handler
  activateProtocolHandler(context);

  // Inspect Manager watches for changes to inspect binary
  start("Monitor Inspect Binary");
  const inspectManager = activateInspectManager(context);
  context.subscriptions.push(inspectManager);
  end("Monitor Inspect Binary");

  // Workspace environment
  await activateWorkspaceEnvironment(context, stateManager);

  // Eval Manager
  start("Setup Eval Command");
  const [inspectEvalCommands, inspectEvalMgr] = activateEvalManager(
    stateManager,
    context
  );

  // Activate commands interface
  activateInspectCommands(stateManager, context);
  end("Setup Eval Command");

  // Activate a watcher which inspects the active document and determines
  // the active task (if any)
  start("Monitor Tasks");
  const [taskCommands, activeTaskManager] = activateActiveTaskProvider(
    inspectEvalMgr,
    context
  );

  // Active the workspace manager to watch for tasks
  const workspaceTaskMgr = activateWorkspaceTaskProvider(
    inspectManager,
    context
  );
  end("Monitor Tasks");

  // Read the extension configuration
  const settingsMgr = new InspectSettingsManager(() => {});

  // initialiaze view server
  start("Setup View Server");
  const server = new InspectViewServer(context, inspectManager);
  context.subscriptions.push(server);
  end("Setup View Server");

  // initialise logs watcher
  start("Setup Output Watcher");
  const outputWatcher = new OutputWatcher(stateManager);
  end("Setup Output Watcher");

  // Activate the log view
  start("Setup Log Viewer");
  const [logViewCommands, logviewWebviewManager] = await activateLogview(
    inspectManager,
    server,
    workspaceEnvManager,
    outputWatcher,
    context
  );
  const inspectLogviewManager = logviewWebviewManager;

  // initilisze open log
  activateOpenLog(context, logviewWebviewManager);
  end("Setup Log Viewer");

  // Activate the Activity Bar
  start("Setup Activity Bar");
  const taskBarCommands = await activateActivityBar(
    inspectManager,
    inspectEvalMgr,
    inspectLogviewManager,
    activeTaskManager,
    workspaceTaskMgr,
    stateManager,
    workspaceEnvManager,
    server,
    outputWatcher,
    context
  );
  end("Setup Activity Bar");

  // Activate Scout
  start("Setup Scout");
  const [scoutManager, scoutCommands] = await activateScout(
    context,
    workspaceEnvManager,
    stateManager,
    outputWatcher,
    settingsMgr
  );
  end("Setup Scout");

  start("Final Setup");
  // Register the log view link provider
  window.registerTerminalLinkProvider(
    logviewTerminalLinkProvider(context, outputWatcher)
  );

  // Activate Code Lens
  activateCodeLens(context);

  // Activate Status Bar
  activateStatusBar(context, inspectManager, scoutManager);

  // Activate Log Notification
  activateLogNotify(context, outputWatcher, settingsMgr, inspectLogviewManager);

  // Activate commands
  [
    ...logViewCommands,
    ...inspectEvalCommands,
    ...taskBarCommands,
    ...stateCommands,
    ...envComands,
    ...taskCommands,
    ...scoutCommands,
  ].forEach(cmd => commandManager.register(cmd));
  context.subscriptions.push(commandManager);

  end("Final Setup");

  // refresh the active task state
  start("Refresh Tasks");
  await activeTaskManager.refresh();
  end("Refresh Tasks");
}

export async function activateScout(
  context: ExtensionContext,
  workspaceEnvManager: WorkspaceEnvManager,
  workspaceStateManager: WorkspaceStateManager,
  outputWatcher: OutputWatcher,
  _settingsMgr: InspectSettingsManager
): Promise<[PackageManager, Command[]]> {
  // Scout Project watches for scout.yml/yaml config files
  start("Setup Scout Project");
  const [projectCommands, scoutProjectManager] = activateScoutProject(context);
  end("Setup Scout Project");

  // Scout Manager watches for changes to scout binary
  start("Monitor Scout Binary");
  const scoutManager = activateScoutManager(context);
  context.subscriptions.push(scoutManager);
  end("Monitor Scout Binary");

  // initialiaze view server
  start("Setup Scout View Server");
  const server = new ScoutViewServer(context, scoutManager);
  context.subscriptions.push(server);
  end("Setup Scout View Server");

  // Register the scout terminal provider
  window.registerTerminalLinkProvider(scanviewTerminalLinkProvider(context));

  // Activate the log view
  start("Setup Scout Viewer");
  const [scoutViewCommands, _] = activateScanview(
    scoutManager,
    server,
    workspaceEnvManager,
    context
  );
  activateOpenScan(context);
  end("Setup Scout Viewer");

  // Activate the Activity Bar
  start("Scout Activity Bar");
  const activityBarCommands = await activateScoutActivityBar(
    scoutManager,
    scoutProjectManager,
    server,
    outputWatcher,
    context
  );
  end("Scout Activity Bar");

  // Activate scan notify
  // activateScanNotify(context, outputWatcher, settingsMgr);

  // Activate scan commands
  const scanManagerCommands = activateScoutScanManager(
    workspaceStateManager,
    context
  );

  // Activate code lends
  activateScoutCodeLens(context);

  // Activate YAML schema support for Scout config files
  start("Setup YAML Schemas");
  const yamlDisposable = await activateYamlSchemaProvider(context);
  if (yamlDisposable) {
    context.subscriptions.push(yamlDisposable);
  }
  end("Setup YAML Schemas");

  return Promise.resolve([
    scoutManager,
    [
      ...projectCommands,
      ...scoutViewCommands,
      ...activityBarCommands,
      ...scanManagerCommands,
    ],
  ]);
}

const checkInspectVersion = async () => {
  if (inspectBinPath()) {
    const descriptor = inspectVersionDescriptor();
    if (
      descriptor &&
      descriptor.version.compare(kInspectMinimumVersion) === -1
    ) {
      const close: MessageItem = { title: "Close" };
      await window.showInformationMessage<MessageItem>(
        "The VS Code extension requires a newer version of Inspect. Please update " +
          "with pip install --upgrade inspect-ai",
        close
      );
    }
  }
};
