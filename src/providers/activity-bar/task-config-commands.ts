import { Command } from "../../core/command";
import { toAbsolutePath } from "../../core/path";
import { ActiveTaskManager } from "../active-task/active-task-provider";
import { scheduleReturnFocus } from "../../components/focus";
import { ExecManager } from "../../core/package/exec-manager";

export class RunConfigTaskCommand implements Command {
  constructor(
    private readonly manager_: ActiveTaskManager,
    private readonly inspectMgr_: ExecManager
  ) {}
  async execute(): Promise<void> {
    const taskInfo = this.manager_.getActiveTaskInfo();
    if (taskInfo) {
      const docPath = toAbsolutePath(taskInfo.document.fsPath);
      const evalPromise = this.inspectMgr_.start(
        docPath,
        taskInfo.activeTask?.name,
        false
      );
      scheduleReturnFocus("inspect_ai.task-configuration.focus");
      await evalPromise;
    }
  }

  private static readonly id = "inspect.runConfigTask";
  public readonly id = RunConfigTaskCommand.id;
}

export class DebugConfigTaskCommand implements Command {
  constructor(
    private readonly manager_: ActiveTaskManager,
    private readonly inspectMgr_: ExecManager
  ) {}
  async execute(): Promise<void> {
    const taskInfo = this.manager_.getActiveTaskInfo();
    if (taskInfo) {
      const docPath = toAbsolutePath(taskInfo.document.fsPath);
      const evalPromise = this.inspectMgr_.start(
        docPath,
        taskInfo.activeTask?.name,
        true
      );
      scheduleReturnFocus("inspect_ai.task-configuratio.focus");
      await evalPromise;
    }
  }

  private static readonly id = "inspect.debugConfigTask";
  public readonly id = DebugConfigTaskCommand.id;
}
