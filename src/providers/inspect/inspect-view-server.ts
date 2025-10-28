import { ExtensionContext, Uri } from "vscode";

import {
  hasMinimumInspectVersion,
  withMinimumInspectVersion,
} from "../../inspect/version";
import {
  kInspectEvalLogFormatVersion,
  kInspectLogMessageVersion,
  kInspectOpenInspectViewVersion,
} from "./inspect-constants";
import {
  inspectEvalLog,
  inspectEvalLogHeaders,
  inspectEvalLogs,
} from "../../inspect/logs";
import { activeWorkspacePath } from "../../core/path";
import { activeWorkspaceFolder } from "../../core/workspace";
import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import { inspectBinPath } from "../../inspect/props";

const kNotFoundSignal = "NotFound";
const kNotModifiedSignal = "NotModified";

export class InspectViewServer extends PackageViewServer {
  constructor(context: ExtensionContext, inspectManager: PackageManager) {
    super(
      context,
      inspectManager,
      ["view", "start"],
      7676,
      "inspect",
      inspectBinPath,
      ["--no-ansi"],
      "http"
    );
  }

  public async evalLogDir(): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      return this.api_json(`/api/log-dir`);
    } else {
      throw new Error("evalLogDir not implemented");
    }
  }

  public async evalLogFiles(
    mtime: number,
    clientFileCount: number
  ): Promise<string | undefined> {
    const log_file_token = (mtime: number, fileCount: number): string => {
      // Use a weak etag as the mtime and file count may not
      // uniquely identify the state of the log directory
      return `W/"${mtime}-${fileCount}"`;
    };

    if (this.haveInspectEvalLogFormat()) {
      const headers: Record<string, string> = {};
      const token = log_file_token(mtime, clientFileCount);
      if (token) {
        headers["If-None-Match"] = token;
      }
      return this.api_json("/api/log-files", headers);
    } else {
      throw new Error("evalLogFile not implemented");
    }
  }

  public async evalLogs(log_dir: Uri): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      return this.api_json(
        `/api/logs?log_dir=${encodeURIComponent(log_dir.toString())}`
      );
    } else {
      return evalLogs(log_dir);
    }
  }

  public async evalLogsSolo(log_file: Uri): Promise<string> {
    if (this.haveInspectEvalLogFormat()) {
      await this.ensureRunning();
    }
    return JSON.stringify({
      log_dir: "",
      files: [{ name: log_file.toString(true) }],
    });
  }

  public async evalLog(
    file: string,
    headerOnly: boolean | number
  ): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      return await this.api_json(
        `/api/logs/${encodeURIComponent(file)}?header-only=${headerOnly}`
      );
    } else {
      return evalLog(file, headerOnly);
    }
  }

  public async evalLogSize(file: string): Promise<number> {
    if (this.haveInspectEvalLogFormat()) {
      return Number(
        await this.api_json(`/api/log-size/${encodeURIComponent(file)}`)
      );
    } else {
      throw new Error("evalLogSize not implemented");
    }
  }

  public async evalLogDelete(file: string): Promise<number> {
    if (this.haveInspectEvalLogFormat()) {
      return Number(
        await this.api_json(`/api/log-delete/${encodeURIComponent(file)}`)
      );
    } else {
      throw new Error("evalLogDelete not implemented");
    }
  }

  public async evalLogBytes(
    file: string,
    start: number,
    end: number
  ): Promise<Uint8Array> {
    if (this.haveInspectEvalLogFormat()) {
      return this.api_bytes(
        `/api/log-bytes/${encodeURIComponent(file)}?start=${start}&end=${end}`
      );
    } else {
      throw new Error("evalLogBytes not implemented");
    }
  }

  public async evalLogHeaders(files: string[]): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      const params = new URLSearchParams();
      for (const file of files) {
        params.append("file", file);
      }
      return this.api_json(`/api/log-headers?${params.toString()}`);
    } else {
      return evalLogHeaders(files);
    }
  }

  public async evalLogPendingSamples(
    log_file: string,
    etag?: string
  ): Promise<string | undefined> {
    const params = new URLSearchParams();
    params.append("log", log_file);

    const headers: Record<string, string> = {};
    if (etag) {
      headers.etag = etag;
    }

    // If the server returns 304/404, transform this into the proper
    // rpc response
    const handleError = (status: number) => {
      if (status === 404) {
        return kNotFoundSignal;
      } else if (status === 304) {
        return kNotModifiedSignal;
      }
    };

    return this.api_json(
      `/api/pending-samples?${params.toString()}`,
      headers,
      handleError
    );
  }

  public async evalLogSampleData(
    log_file: string,
    id: string | number,
    epoch: number,
    last_event?: number,
    last_attachment?: number
  ): Promise<string | undefined> {
    // Url Params
    const params = new URLSearchParams();
    params.append("log", log_file);
    params.append("id", String(id));
    params.append("epoch", String(epoch));
    if (last_event) {
      params.append("last-event-id", String(last_event));
    }
    if (last_attachment) {
      params.append("after-attachment-id", String(last_attachment));
    }

    // If the server returns 304/404, transform this into the proper
    // rpc response
    const handleError = (status: number) => {
      if (status === 404) {
        return kNotFoundSignal;
      } else if (status === 304) {
        return kNotModifiedSignal;
      }
    };
    return this.api_json(
      `/api/pending-sample-data?${params.toString()}`,
      {},
      handleError
    );
  }

  public async logMessage(log_file: string, message?: string): Promise<void> {
    if (hasMinimumInspectVersion(kInspectLogMessageVersion)) {
      await this.api_json(
        `/api/log-message/${encodeURIComponent(log_file)}?message=${encodeURIComponent(
          message || ""
        )}`
      );
      return undefined;
    } else {
      // Old clients don't support this
      console.log(`[CLIENT MESSAGE] (${log_file}): ${message}`);
      return Promise.resolve(undefined);
    }
  }

  override async ensureRunning(): Promise<void> {
    // only do this if we have a new enough version of inspect
    if (!this.haveInspectEvalLogFormat()) {
      return;
    }
    return await super.ensureRunning();
  }

  private haveInspectEvalLogFormat() {
    return hasMinimumInspectVersion(kInspectEvalLogFormatVersion);
  }
}

// The eval commands below need to be coordinated in terms of their working directory
// The evalLogs() call will return log files with relative paths to the working dir (if possible)
// and subsequent calls like evalLog() need to be able to deal with these relative paths
// by using the same working directory.
//
// So, we always use the workspace root as the working directory and will resolve
// paths that way. Note that paths can be S3 urls, for example, in which case the paths
// will be absolute (so cwd doesn't really matter so much in this case).
function evalLogs(log_dir: Uri): Promise<string | undefined> {
  // Return both the log_dir and the logs

  const response = withMinimumInspectVersion<string | undefined>(
    kInspectOpenInspectViewVersion,
    () => {
      const workspaceRoot = activeWorkspaceFolder().uri;
      const logs = inspectEvalLogs(activeWorkspacePath(), log_dir);
      const logsJson = (logs ? JSON.parse(logs) : []) as Array<{
        name: string;
      }>;
      return JSON.stringify({
        log_dir: log_dir.toString(true),
        files: logsJson.map(log => ({
          ...log,
          name: Uri.joinPath(workspaceRoot, log.name).toString(true),
        })),
      });
    },
    () => {
      // Return the original log content
      return inspectEvalLogs(activeWorkspacePath());
    }
  );
  return Promise.resolve(response);
}

function evalLog(
  file: string,
  headerOnly: boolean | number
): Promise<string | undefined> {
  // Old clients pass a boolean value which we need to resolve
  // into the max number of MB the log can be before samples are excluded
  // and it becomes header_only
  if (typeof headerOnly === "boolean") {
    headerOnly = headerOnly ? 0 : Number.MAX_SAFE_INTEGER;
  }

  return Promise.resolve(
    inspectEvalLog(activeWorkspacePath(), file, headerOnly)
  );
}

function evalLogHeaders(files: string[]) {
  return Promise.resolve(inspectEvalLogHeaders(activeWorkspacePath(), files));
}
