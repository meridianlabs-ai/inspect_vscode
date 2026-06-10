import {
  debug,
  DebugConfiguration,
  ExtensionContext,
  Terminal,
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

/**
 * Waits until shell integration becomes active on `terminal`, or until
 * `timeoutMs` elapses. Returns the integration object if it activated in time,
 * or `undefined` if it didn't (shell integration disabled or too slow).
 */
const waitForShellIntegration = (
  terminal: Terminal,
  timeoutMs: number
): Promise<(typeof terminal)["shellIntegration"]> => {
  // Already active — no waiting needed (reused terminal or fast startup).
  if (terminal.shellIntegration) {
    return Promise.resolve(terminal.shellIntegration);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(undefined);
    }, timeoutMs);

    const listener = window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) {
        clearTimeout(timer);
        listener.dispose();
        resolve(e.shellIntegration);
      }
    });
  });
};

const runCommand = async (
  profile: ExecProfile,
  args: string[],
  cwd: string,
  python?: AbsolutePath
) => {
  // Reuse a named terminal so the user can see previous runs and so the
  // Python extension's env-activation hooks have already run.
  const name = profile.terminal;
  let terminal = window.terminals.find((t) => t.name === name);
  const reusedTerminal = terminal !== undefined;
  if (!terminal) {
    terminal = window.createTerminal({ name, cwd });
  }
  terminal.show(true);

  const { command, args: commandArgs } = buildRunCommand(profile, args, python);

  // Prefer shell integration (available in VS Code 1.93+): it fires after the
  // shell's init sequence completes, so the Python env is activated and
  // `inspect` is on PATH before the command is sent. It also handles quoting
  // and gives the terminal proper command decorations.
  //
  // On a reused terminal integration is usually already active; on a new
  // terminal we wait up to 10 s for it to activate. If it doesn't (shell
  // integration disabled, older VS Code build, or the shell doesn't support
  // it), we fall back to sendText with a fixed delay.
  const kShellIntegrationTimeoutMs = 10_000;
  const integration = await waitForShellIntegration(
    terminal,
    kShellIntegrationTimeoutMs
  );

  const creationOptions = terminal.creationOptions;
  const shellPath =
    "shellPath" in creationOptions ? creationOptions.shellPath : undefined;
  const shell = detectShellKind(shellPath);
  const commandLine = quoteCommandLine([command, ...commandArgs], shell);

  if (integration) {
    // Shell integration is active: the env is ready. Emit a `cd` first on
    // reused terminals (executeCommand doesn't change the working directory).
    if (reusedTerminal) {
      integration.executeCommand(`cd ${quoteArg(cwd, shell)}`);
    }
    integration.executeCommand(commandLine);
  } else {
    // Fallback: shell integration unavailable. Use sendText with a delay on
    // new terminals to give the activation scripts time to finish.
    if (!reusedTerminal) {
      await sleep(2000);
    }
    if (reusedTerminal) {
      terminal.sendText(`cd ${quoteArg(cwd, shell)}`);
    }
    terminal.sendText(commandLine);
  }
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
