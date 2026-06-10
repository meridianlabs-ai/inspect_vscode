import {
  debug,
  DebugConfiguration,
  ExtensionContext,
  window,
  workspace,
} from "vscode";

import { sleep } from "../../core/wait";
import { extensionVersion } from "../../providers/environment";
import {
  DocumentState,
  WorkspaceStateManager,
} from "../../providers/workspace/workspace-state-provider";
import { VersionDescriptor } from "../package/props";
import {
  AbsolutePath,
  activeWorkspacePath,
  workspaceRelativePath,
} from "../path";
import { findEnvPythonPath } from "../python";
import { detectShellKind, quoteArg, quoteCommandLine } from "../shell-quote";
import { activeWorkspaceFolder } from "../workspace";

export interface ExecProfile {
  packageName: "inspect-ai" | "inspect-scout";
  packageDisplayName: "Inspect" | "Inspect Scout";
  packageVersion: VersionDescriptor | null;
  target: "Eval" | "Scan";
  terminal: "Inspect Eval" | "Scout Scan";
  command: "inspect" | "scout";
  subcommand: "eval" | "scan";
  binPath: AbsolutePath | null;
  execArgs: (docState: DocumentState, debug: boolean) => string[];
}

export class ExecManager {
  constructor(
    private readonly profile_: ExecProfile,
    private readonly stateManager_: WorkspaceStateManager,
    context: ExtensionContext
  ) {
    this.context_ = context;
  }
  private context_: ExtensionContext;

  public async start(file: AbsolutePath, target?: string, debug = false) {
    // if we don't have scout bail and let the user know
    if (!this.profile_.packageVersion) {
      await window.showWarningMessage(
        `Unable to ${
          debug ? "Debug" : "Run"
        } ${this.profile_.target} (${this.profile_.packageDisplayName} Package Not Installed)`,
        {
          modal: true,
          detail: `pip install --upgrade ${this.profile_.packageName}`,
        }
      );
      return;
    }

    const workspaceDir = activeWorkspacePath();
    const relativePath = workspaceRelativePath(file);

    // The base set of task args
    const targetArg = target ? `${relativePath}@${target}` : relativePath;
    const args = [this.profile_.subcommand, targetArg];

    // additional args
    const docState = this.stateManager_.getTaskState(file.path, target);
    args.push(...this.profile_.execArgs(docState, debug));

    // Find the python environment
    const useSubdirectoryEnvironments = workspace
      .getConfiguration("inspect_ai")
      .get("useSubdirectoryEnvironments");
    const pythonPath = useSubdirectoryEnvironments
      ? findEnvPythonPath(file.dirname(), activeWorkspacePath())
      : undefined;

    // If we're debugging, launch using the debugger
    if (debug) {
      // Pass the workspace ID to the debug environment so we'll
      // properly target the workspace window when showing the logview
      const env = {
        INSPECT_WORKSPACE_ID: this.stateManager_.getWorkspaceInstance(),
        INSPECT_VSCODE_EXT_VERSION: extensionVersion(this.context_),
      };

      await runDebugger(
        this.profile_,
        this.profile_.binPath?.path || this.profile_.command,
        args,
        workspaceDir.path,
        env,
        pythonPath ? pythonPath : undefined
      );
    } else {
      // Run the command
      await runCommand(
        this.profile_,
        args,
        workspaceDir.path,
        pythonPath ? pythonPath : undefined
      );
    }
  }
}

/**
 * Builds the program and argument vector for a run command.
 *
 * Returns the executable to invoke (`python -m <packageName>` when a python
 * interpreter is supplied, otherwise the bare command) plus the arguments as
 * plain, *unquoted* strings. Quoting is the caller's responsibility because it
 * depends on the shell the command will be sent to (see {@link runCommand} and
 * the `shell-quote` module).
 *
 * Pure and side-effect free so it can be unit tested with hostile inputs.
 */
export const buildRunCommand = (
  profile: ExecProfile,
  args: string[],
  python?: AbsolutePath
): { command: string; args: string[] } => {
  if (python) {
    return {
      command: python.path,
      args: ["-m", profile.packageName, ...args],
    };
  }
  return {
    command: profile.command,
    args,
  };
};

const runCommand = async (
  profile: ExecProfile,
  args: string[],
  cwd: string,
  python?: AbsolutePath
) => {
  // See if there a non-busy terminal that we can re-use. The integrated
  // terminal is created by the Python extension's activation hooks, so the
  // selected interpreter / `inspect` is on PATH — which is why we run here
  // rather than via the Tasks API.
  const name = profile.terminal;
  let terminal = window.terminals.find((t) => {
    return t.name === name;
  });
  const reusedTerminal = terminal !== undefined;
  if (!terminal) {
    // A new terminal's working directory is set natively via the `cwd` option,
    // so it never passes through the shell.
    terminal = window.createTerminal({ name, cwd });
  }
  terminal.show(true);

  const kRequiredDelay = 1000;
  const kInterval = 100;
  let totalSleep = 0;
  while (!terminal.state.isInteractedWith && totalSleep < kRequiredDelay) {
    await sleep(kInterval);
    totalSleep += kInterval;
  }

  // Quote everything for the shell this terminal is actually running, so paths,
  // task targets, and `-T key=value` params that contain spaces or shell
  // metacharacters are passed as literal tokens. This fixes the space-in-path
  // bug and closes the command-injection hole left by raw string-joining.
  const creationOptions = terminal.creationOptions;
  const shellPath =
    "shellPath" in creationOptions ? creationOptions.shellPath : undefined;
  const shell = detectShellKind(shellPath);

  // A reused terminal may be sitting in a different directory, so move it to
  // the workspace directory first (quoted in case the path contains spaces).
  if (reusedTerminal) {
    terminal.sendText(`cd ${quoteArg(cwd, shell)}`);
  }

  const { command, args: commandArgs } = buildRunCommand(profile, args, python);
  terminal.sendText(quoteCommandLine([command, ...commandArgs], shell));
};

const runDebugger = async (
  profile: ExecProfile,
  program: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
  pythonPath?: AbsolutePath
) => {
  const name = profile.terminal;
  const debugConfiguration: DebugConfiguration = {
    name,
    type: "debugpy",
    request: "launch",
    program,
    args,
    console: "integratedTerminal",
    cwd,
    env,
    justMyCode: false,
    pythonPath: pythonPath?.path,
  };
  await debug.startDebugging(activeWorkspaceFolder(), debugConfiguration);
};
