import * as os from "os";

import {
  debug,
  DebugConfiguration,
  ExtensionContext,
  MessageItem,
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

    const useIt: MessageItem = { title: "Use Environment" };
    const cancel: MessageItem = {
      title: "Use Selected Interpreter",
      isCloseAffordance: true,
    };
    const choice = await window.showWarningMessage(
      `Run ${this.profile_.target} with a Python environment from this workspace?`,
      {
        modal: true,
        detail:
          `Inspect found this environment inside the workspace and would run it ` +
          `instead of your selected interpreter:\n\n${python.path}\n\n` +
          `Running the ${this.profile_.target.toLowerCase()} executes code from ` +
          `that environment, so only continue if you trust this workspace — a ` +
          `project can plant an environment here to run arbitrary code on your ` +
          `machine.\n\nYour choice is remembered for this environment. To always ` +
          `use your selected interpreter, turn off ` +
          `"inspect_ai.useSubdirectoryEnvironments".`,
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

  // Quote for the shell that actually runs in the terminal. The command line is
  // sent verbatim, so quoting for a different shell than the one interpreting it
  // is a command-injection vector — PowerShell single quotes are inert in
  // cmd.exe, so an `&` in an attacker-controlled task path/name would execute.
  // Identify the shell from the explicit creation path, then the actual shell
  // reported after integration activates, then the configured default profile.
  const creationOptions = terminal.creationOptions;
  const creationShellPath =
    "shellPath" in creationOptions ? creationOptions.shellPath : undefined;
  const actualShell = (terminal.state as { shell?: string }).shell;
  const shell: ShellKind | undefined =
    shellKindFromPath(creationShellPath) ??
    shellKindFromPath(actualShell) ??
    configuredDefaultShellKind();

  // Build the command line (and optional `cd`). When the shell can't be
  // identified, fall back to cross-shell-safe double quoting; if a token can't
  // be safely quoted for an unknown shell, refuse to run rather than risk
  // injection.
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
        `Unable to ${profile.target === "Scan" ? "run scan" : "run task"}: the task path or arguments contain characters that can't be safely quoted for this terminal's shell. Select a known shell profile (PowerShell, cmd, or a POSIX shell) or rename the offending file/parameters.`
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
 * Best-effort identification of the shell VS Code's default terminal profile
 * launches, used when the terminal itself doesn't report its shell. Returns
 * `undefined` on Windows when the default profile can't be mapped, so the caller
 * uses cross-shell-safe quoting instead of guessing. On other platforms the
 * default shells are POSIX-family.
 */
const configuredDefaultShellKind = (): ShellKind | undefined => {
  if (os.platform() !== "win32") {
    return "posix";
  }
  const cfg = workspace.getConfiguration("terminal.integrated");
  const profileName = cfg.get<string>("defaultProfile.windows") ?? undefined;
  if (!profileName) {
    return undefined;
  }
  const profiles =
    cfg.get<Record<string, { path?: string | string[]; source?: string }>>(
      "profiles.windows"
    ) ?? {};
  const profile = profiles[profileName];
  const pathVal = profile?.path;
  const path = Array.isArray(pathVal) ? pathVal[0] : pathVal;
  const byPath = shellKindFromPath(path) ?? shellKindFromPath(profile?.source);
  if (byPath) {
    return byPath;
  }
  const lower = profileName.toLowerCase();
  if (lower.includes("command prompt") || lower === "cmd") {
    return "cmd";
  }
  if (lower.includes("powershell") || lower.includes("pwsh")) {
    return "powershell";
  }
  if (
    lower.includes("git bash") ||
    lower.includes("wsl") ||
    lower.includes("bash") ||
    lower.includes("zsh")
  ) {
    return "posix";
  }
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
