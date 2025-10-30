import { Uri } from "vscode";
import { Command } from "../../core/command";
import { toAbsolutePath } from "../../core/path";
import { scheduleFocusActiveEditor } from "../../components/focus";
import { ExecManager } from "../../core/package/exec-manager";

export function inspectEvalCommands(manager: ExecManager): Command[] {
  return [new RunEvalCommand(manager), new DebugEvalCommand(manager)];
}

export class RunEvalCommand implements Command {
  constructor(private readonly manager_: ExecManager) {}
  async execute(documentUri: Uri, fnName: string): Promise<void> {
    const cwd = toAbsolutePath(documentUri.fsPath);

    const evalPromise = this.manager_.start(cwd, fnName, false);
    scheduleFocusActiveEditor();
    await evalPromise;
  }
  private static readonly id = "inspect.runTask";
  public readonly id = RunEvalCommand.id;
}

export class DebugEvalCommand implements Command {
  constructor(private readonly manager_: ExecManager) {}
  async execute(documentUri: Uri, fnName: string): Promise<void> {
    const cwd = toAbsolutePath(documentUri.fsPath);
    await this.manager_.start(cwd, fnName, true);
  }
  private static readonly id = "inspect.debugTask";
  public readonly id = DebugEvalCommand.id;
}
