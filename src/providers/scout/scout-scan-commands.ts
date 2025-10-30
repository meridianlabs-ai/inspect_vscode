import { Uri } from "vscode";
import { Command } from "../../core/command";
import { toAbsolutePath } from "../../core/path";
import { ExecManager } from "../../core/package/exec-manager";

export function scoutScanCommands(manager: ExecManager): Command[] {
  return [new RunScoutScanCommand(manager), new DebugScoutScanCommand(manager)];
}

export class RunScoutScanCommand implements Command {
  constructor(private readonly manager_: ExecManager) {}
  async execute(documentUri: Uri, fnName: string): Promise<void> {
    const cwd = toAbsolutePath(documentUri.fsPath);

    const evalPromise = this.manager_.start(cwd, fnName, false);
    await evalPromise;
  }
  private static readonly id = "inspect.runScoutScan";
  public readonly id = RunScoutScanCommand.id;
}

export class DebugScoutScanCommand implements Command {
  constructor(private readonly manager_: ExecManager) {}
  async execute(documentUri: Uri, fnName: string): Promise<void> {
    const cwd = toAbsolutePath(documentUri.fsPath);
    await this.manager_.start(cwd, fnName, true);
  }
  private static readonly id = "inspect.debugScoutScan";
  public readonly id = DebugScoutScanCommand.id;
}
