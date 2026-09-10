import * as os from "os";

import {
  debug,
  DebugConfiguration,
  env,
  ExtensionContext,
  MessageItem,
  Terminal,
  window,
  workspace,
  WorkspaceConfiguration,
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
import {
  quoteArg,
  quoteArgUnknownShell,
  quoteCommandLine,
  quoteCommandLineUnknownShell,
  ShellKind,
  shellKindFromPath,
} from "../shell-quote";
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

    // Find the python environment. A discovered subdirectory interpreter would
    // be executed in place of the user's selected interpreter, so a repository
    // can ship a fake environment (a directory with pyvenv.cfg plus an
    // executable bin/python) to run arbitrary code on Run/Debug Task. Require
    // explicit, remembered per-environment consent before executing it.
    const useSubdirectoryEnvironments = workspace
      .getConfiguration("inspect_ai")
      .get("useSubdirectoryEnvironments");
    const discoveredPython = useSubdirectoryEnvironments
      ? findEnvPythonPath(file.dirname(), activeWorkspacePath())
      : undefined;
    const pythonPath =
      discoveredPython &&
      (await this.confirmSubdirectoryEnvironment(discoveredPython))
        ? discoveredPython
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

  // Approvals are remembered per interpreter path for the workspace so a trusted
  // subdirectory environment (e.g. the user's own .venv) is only confirmed once.
  private static readonly kApprovedEnvKey =
    "inspect.approvedSubdirectoryEnvironments";

  private async confirmSubdirectoryEnvironment(
    python: AbsolutePath
  ): Promise<boolean> {
    const approved = this.context_.workspaceState.get<string[]>(
      ExecManager.kApprovedEnvKey,
      []
    );
    if (approved.includes(python.path)) {
      return true;
    }

    const useIt: MessageItem = { title: "Use Workspace Environment" };
    const cancel: MessageItem = {
      title: "Use Selected Interpreter",
      isCloseAffordance: true,
    };
    const choice = await window.showWarningMessage(
      `Run ${this.profile_.target} with a workspace Python environment?`,
      {
        modal: true,
        detail:
          `Inspect found a Python environment inside the workspace and would run ` +
          `it instead of your selected interpreter:\n\n${python.path}\n\n` +
          `Running the ${this.profile_.target.toLowerCase()} executes code from ` +
          `that environment, so only continue if you trust this workspace.\n\n` +
          `Approval is remembered for this environment. To always use your ` +
          `selected interpreter, turn off "inspect_ai.useSubdirectoryEnvironments".`,
      },
      useIt,
      cancel
    );
    if (choice === useIt) {
      await this.context_.workspaceState.update(ExecManager.kApprovedEnvKey, [
        ...approved,
        python.path,
      ]);
      return true;
    }
    return false;
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

  const shell = terminalShellKind(
    terminal,
    workspace.getConfiguration("terminal.integrated"),
    os.platform(),
    env.shell
  );
  if (!shell && os.platform() !== "win32") {
    await window.showErrorMessage(
      `Unable to ${profile.target === "Scan" ? "run scan" : "run task"}: this terminal's shell could not be identified. Select a supported shell profile (bash, zsh, sh, dash, ksh, fish, PowerShell, or cmd) and close the existing ${profile.terminal} terminal before retrying.`
    );
    return;
  }

  // Build the command line (and optional `cd`). When the shell can't be
  // identified on Windows, fall back to cmd/PowerShell double quoting. Refuse
  // tokens that cannot be safely quoted rather than risk injection.
  let commandLine: string;
  let cdLine: string | undefined;
  if (shell) {
    commandLine = quoteCommandLine([command, ...commandArgs], shell);
    cdLine = reusedTerminal ? `cd ${quoteArg(cwd, shell)}` : undefined;
  } else {
    const line = quoteCommandLineUnknownShell([command, ...commandArgs]);
    const cwdQuoted = reusedTerminal ? quoteArgUnknownShell(cwd) : "";
    if (line === null || cwdQuoted === null) {
      await window.showErrorMessage(
        `Unable to ${profile.target === "Scan" ? "run scan" : "run task"}: the task path or arguments contain characters that can't be safely quoted for this terminal's shell. Select a known shell profile (PowerShell, cmd, fish, or a POSIX shell) and close this terminal before retrying.`
      );
      return;
    }
    commandLine = line;
    cdLine = reusedTerminal ? `cd ${cwdQuoted}` : undefined;
  }

  if (integration) {
    // Shell integration is active: the env is ready. Emit a `cd` first on
    // reused terminals (executeCommand doesn't change the working directory).
    if (cdLine) {
      integration.executeCommand(cdLine);
    }
    integration.executeCommand(commandLine);
  } else {
    // Fallback: shell integration unavailable. Use sendText with a delay on
    // new terminals to give the activation scripts time to finish.
    if (!reusedTerminal) {
      await sleep(2000);
    }
    if (cdLine) {
      terminal.sendText(cdLine);
    }
    terminal.sendText(commandLine);
  }
};

/**
 * Identify the terminal's shell without guessing a platform default. A reported
 * shell takes precedence over launch settings, which may describe a wrapper or
 * a shell the user has since left. An explicit but unrecognized executable must
 * not fall through to a different shell's quoting rules.
 */
export const terminalShellKind = (
  terminal: Pick<Terminal, "creationOptions" | "state">,
  cfg: Pick<WorkspaceConfiguration, "get"> = workspace.getConfiguration(
    "terminal.integrated"
  ),
  platform: NodeJS.Platform = os.platform(),
  defaultShellPath?: string
): ShellKind | undefined => {
  const actualShell = (terminal.state as { shell?: string }).shell;
  if (actualShell) {
    return shellKindFromPath(actualShell);
  }
  const options = terminal.creationOptions;
  if ("shellPath" in options && options.shellPath) {
    return shellKindFromPath(options.shellPath);
  }

  const key =
    platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";
  const profileName = cfg.get<string>(`defaultProfile.${key}`);
  if (!profileName) {
    // VS Code exposes the detected default executable via env.shell. Identify
    // that path rather than assuming that every Unix default is POSIX.
    return shellKindFromPath(defaultShellPath);
  }
  const profiles =
    cfg.get<Record<string, { path?: string | string[]; source?: string }>>(
      `profiles.${key}`
    ) ?? {};
  const profile = profiles[profileName];
  if (profile?.path) {
    // VS Code chooses the first existing executable from a path array. Only
    // select quoting when every candidate has the same recognized grammar.
    const paths = Array.isArray(profile.path) ? profile.path : [profile.path];
    const kinds = paths.map(shellKindFromPath);
    return kinds.length > 0 && kinds.every((kind) => kind === kinds[0])
      ? kinds[0]
      : undefined;
  }
  if (profile?.source) {
    // VS Code's built-in detected profile sources (not arbitrary labels).
    if (profile.source === "PowerShell") {
      return "powershell";
    }
    if (profile.source === "Git Bash") {
      return "posix";
    }
    return undefined;
  }
  // Display names are user-defined and cannot establish an executable's syntax.
  return undefined;
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
