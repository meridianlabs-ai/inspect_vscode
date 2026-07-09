import { closeSync, fstatSync, openSync, readFileSync } from "fs";

import { Disposable, Event, EventEmitter, Uri } from "vscode";

import { inspectLastEvalPaths } from "../../inspect/props";
import { withMinimumInspectVersion } from "../../inspect/version";
import { kInspectChangeEvalSignalVersion } from "../../providers/inspect/inspect-constants";
import { WorkspaceStateManager } from "../../providers/workspace/workspace-state-provider";
import { scoutLastScanPaths } from "../../scout/props";
import { log } from "../log";
import { resolveToUri } from "../uri";

export interface InspectLogCreatedEvent {
  log: Uri;
  externalWorkspace: boolean;
}

export interface ScoutScanCreatedEvent {
  scan: Uri;
  externalWorkspace: boolean;
}

interface SignalFile {
  type: string;
  path: string;
}

export class OutputWatcher implements Disposable {
  constructor(private readonly workspaceStateManager_: WorkspaceStateManager) {
    log.appendLine("Watching for evaluation logs");
    this.lastLog_ = Date.now();
    this.lastScan_ = Date.now();

    const evalSignalFiles: SignalFile[] = inspectLastEvalPaths()
      .map((path) => ({
        type: "log",
        path: path.path,
      }))
      .concat(
        scoutLastScanPaths().map((path) => ({ type: "scan", path: path.path }))
      );

    this.watchInterval_ = setInterval(() => {
      for (const evalSignalFile of evalSignalFiles) {
        // Open the signal file and stat/read through the file descriptor so
        // that the mtime check and the read can't race a concurrent
        // delete/replace of the file
        let fd: number;
        try {
          fd = openSync(evalSignalFile.path, "r");
        } catch {
          // There is no signal file (yet)
          continue;
        }

        try {
          const updated = fstatSync(fd).mtime.getTime();

          const lastTime =
            evalSignalFile.type === "log" ? this.lastLog_ : this.lastScan_;

          if (updated > lastTime) {
            if (evalSignalFile.type === "log") {
              this.lastLog_ = updated;
            } else {
              this.lastScan_ = updated;
            }

            let evalLogPath: string | undefined;
            let workspaceId;
            const contents = readFileSync(fd, {
              encoding: "utf-8",
            });

            // Parse the eval signal file result
            withMinimumInspectVersion(
              kInspectChangeEvalSignalVersion,
              () => {
                // 0.3.10- or later
                const contentsObj = JSON.parse(contents) as {
                  location: string;
                  workspace_id?: string;
                };
                evalLogPath = contentsObj.location;
                workspaceId = contentsObj.workspace_id;
              },
              () => {
                // 0.3.8 or earlier
                evalLogPath = contents;
              }
            );

            if (evalLogPath !== undefined) {
              // see if this is another instance of vscode
              const externalWorkspace =
                !!workspaceId &&
                workspaceId !==
                  this.workspaceStateManager_.getWorkspaceInstance();

              // log
              log.appendLine(`New log: ${evalLogPath}`);

              // fire event
              try {
                const logUri = resolveToUri(evalLogPath);
                if (evalSignalFile.type === "log") {
                  this.onInspectLogCreated_.fire({
                    log: logUri,
                    externalWorkspace,
                  });
                } else {
                  this.onScoutScanCreated_.fire({
                    scan: logUri,
                    externalWorkspace,
                  });
                }
              } catch (_error) {
                log.appendLine(`Unexpected error parsing URI ${evalLogPath}`);
              }
            }
          }
        } finally {
          closeSync(fd);
        }
      }
    }, 500);
  }
  private lastLog_: number;
  private lastScan_: number;
  private watchInterval_: NodeJS.Timeout;

  private readonly onInspectLogCreated_ =
    new EventEmitter<InspectLogCreatedEvent>();
  public readonly onInspectLogCreated: Event<InspectLogCreatedEvent> =
    this.onInspectLogCreated_.event;

  private readonly onScoutScanCreated_ =
    new EventEmitter<ScoutScanCreatedEvent>();
  public readonly onScoutScanCreated: Event<ScoutScanCreatedEvent> =
    this.onScoutScanCreated_.event;

  dispose() {
    if (this.watchInterval_) {
      log.appendLine("Stopping watching for new evaluations logs");
      clearTimeout(this.watchInterval_);
    }
  }
}
