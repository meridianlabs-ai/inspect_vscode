import { ExtensionContext, workspace } from "vscode";

import { Command } from "../../core/command";
import { ExecManager, ExecProfile } from "../../core/package/exec-manager";
import { scoutBinPath, scoutVersionDescriptor } from "../../scout/props";
import {
  DocumentState,
  WorkspaceStateManager,
} from "../workspace/workspace-state-provider";

import { scoutScanCommands } from "./scout-scan-commands";

export function activateScoutScanManager(
  stateManager: WorkspaceStateManager,
  context: ExtensionContext
): Command[] {
  const profile: ExecProfile = {
    packageName: "inspect-scout",
    packageDisplayName: "Inspect Scout",
    packageVersion: scoutVersionDescriptor(),
    target: "Scan",
    terminal: "Scout Scan",
    command: "scout",
    subcommand: "scan",
    binPath: scoutBinPath(),
    execArgs: (_docState: DocumentState, debug: boolean) => {
      const args: string[] = [];

      if (
        debug === true &&
        workspace.getConfiguration("inspect_ai").get("debugSingleTranscript")
      ) {
        args.push(...["--limit", "1"]);
      }

      return args;
    },
  };

  // Activate the manager
  const execManager = new ExecManager(profile, stateManager, context);
  return scoutScanCommands(execManager);
}
