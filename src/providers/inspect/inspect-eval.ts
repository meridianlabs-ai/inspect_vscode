import { ExtensionContext, workspace } from "vscode";
import { inspectEvalCommands } from "./inspect-eval-commands";
import { Command } from "../../core/command";
import {
  DocumentState,
  WorkspaceStateManager,
} from "../workspace/workspace-state-provider";
import { inspectBinPath, inspectVersionDescriptor } from "../../inspect/props";

import { ExecManager, ExecProfile } from "../../core/package/exec-manager";

export function activateEvalManager(
  stateManager: WorkspaceStateManager,
  context: ExtensionContext
): [Command[], ExecManager] {
  const profile: ExecProfile = {
    packageName: "inspect-ai",
    packageDisplayName: "Inspect",
    packageVersion: inspectVersionDescriptor(),
    target: "Eval",
    terminal: "Inspect Eval",
    command: "inspect",
    subcommand: "eval",
    binPath: inspectBinPath(),
    execArgs: (docState: DocumentState, debug: boolean) => {
      const args: string[] = [];

      // Forward the various doc state args
      const limit = docState.limit;
      if (
        debug === true &&
        workspace.getConfiguration("inspect_ai").get("debugSingleSample")
      ) {
        args.push(...["--limit", "1"]);
      } else if (limit) {
        args.push(...["--limit", limit]);
      }

      const epochs = docState.epochs;
      if (epochs) {
        args.push(...["--epochs", epochs]);
      }

      const temperature = docState.temperature;
      if (temperature) {
        args.push(...["--temperature", temperature]);
      }

      const maxTokens = docState.maxTokens;
      if (maxTokens) {
        args.push(...["--max-tokens", maxTokens]);
      }

      const topP = docState.topP;
      if (topP) {
        args.push(...["--top-p", topP]);
      }

      const topK = docState.topK;
      if (topK) {
        args.push(...["--top-k", topK]);
      }

      const sampleIds = docState.sampleIds;
      if (sampleIds) {
        const ids = sampleIds.split(",").map(id => id.trim());
        if (ids.length > 0) {
          args.push(...["--sample-id", ids.join(",")]);
        }
      }

      // Forwards task params
      const taskParams = docState.params;
      if (taskParams) {
        Object.keys(taskParams).forEach(key => {
          const value = taskParams[key];
          args.push(...["-T", `${key}=${value}`]);
        });
      }

      return args;
    },
  };

  // Activate the manager
  const inspectExecManager = new ExecManager(profile, stateManager, context);
  return [inspectEvalCommands(inspectExecManager), inspectExecManager];
}
