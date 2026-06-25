import { ExtensionContext, Uri } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import {
  AbsolutePath,
  activeWorkspacePath,
  toAbsolutePath,
} from "../../core/path";
import { activeWorkspaceFolder } from "../../core/workspace";
import {
  inspectEvalLog,
  inspectEvalLogHeaders,
  inspectEvalLogs,
} from "../../inspect/logs";
import { inspectBinPath } from "../../inspect/props";
import {
  hasMinimumInspectVersion,
  withMinimumInspectVersion,
} from "../../inspect/version";

import {
  kInspectEvalLogFormatVersion,
  kInspectLogMessageVersion,
  kInspectOpenInspectViewVersion,
} from "./inspect-constants";

const kNotFoundSignal = "NotFound";
const kNotModifiedSignal = "NotModified";

export class InspectViewServer extends PackageViewServer {
  constructor(context: ExtensionContext, inspectManager: PackageManager) {
    super(
      context,
      inspectManager,
      ["view", "start"],
      7676,
      "Inspect",
      "inspect",
      inspectBinPath,
      ["--no-ansi"],
      "http"
    );
  }

  public async evalLogDir(): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      return (await this.api_json(`/api/log-dir`)).data;
    } else {
      throw new Error("evalLogDir not implemented");
    }
  }

  public async evalLogFiles(
    log_dir: string,
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

      // Forward the log_dir
      const params = new URLSearchParams();
      params.append("log_dir", log_dir);

      return (
        await this.api_json(
          `/api/log-files?${params.toString()}`,
          "GET",
          headers
        )
      ).data;
    } else {
      throw new Error("evalLogFile not implemented");
    }
  }

  public async evalLogs(log_dir: Uri): Promise<string | undefined> {
    if (this.haveInspectEvalLogFormat()) {
      return (
        await this.api_json(
          `/api/logs?log_dir=${encodeURIComponent(log_dir.toString())}`
        )
      ).data;
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
      return (
        await this.api_json(
          `/api/logs/${encodeURIComponent(file)}?header-only=${headerOnly}`
        )
      ).data;
    } else {
      return evalLog(file, headerOnly);
    }
  }

  public async evalLogSize(file: string): Promise<number> {
    if (this.haveInspectEvalLogFormat()) {
      return Number(
        (await this.api_json(`/api/log-size/${encodeURIComponent(file)}`)).data
      );
    } else {
      throw new Error("evalLogSize not implemented");
    }
  }

  public async evalLogDelete(file: string): Promise<number> {
    if (this.haveInspectEvalLogFormat()) {
      return Number(
        (await this.api_json(`/api/log-delete/${encodeURIComponent(file)}`))
          .data
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
      return (
        await this.api_bytes(
          `/api/log-bytes/${encodeURIComponent(file)}?start=${start}&end=${end}`
        )
      ).data;
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
      return (await this.api_json(`/api/log-headers?${params.toString()}`))
        .data;
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

    return (
      await this.api_json(
        `/api/pending-samples?${params.toString()}`,
        "GET",
        headers,
        handleError
      )
    ).data;
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
    return (
      await this.api_json(
        `/api/pending-sample-data?${params.toString()}`,
        "GET",
        {},
        handleError
      )
    ).data;
  }

  /**
   * Forward a `LogUpdate` to the local inspect view server's
   * `/api/log-edit/{file}` endpoint and return the updated log + new
   * ETag (S3 only) JSON-encoded as `{ "log": EvalLog, "etag"?: string }`.
   *
   * HTTP error codes are surfaced via a thrown `Error` whose `code`
   * field carries the status — the JSON-RPC layer preserves both
   * `message` and `code`, and the webview's `edit_log` handler maps
   * 400/409/412 to the appropriate dialog message.
   */
  public async editLog(
    file: string,
    update: unknown,
    ifMatchEtag?: string
  ): Promise<string> {
    if (!this.haveInspectEvalLogFormat()) {
      throw new Error("editLog not implemented");
    }
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    if (ifMatchEtag) {
      headers.set("If-Match", ifMatchEtag);
    }
    const path = `/api/log-edit/${encodeURIComponent(file)}`;
    const result = await this.serverFetch(
      path,
      "POST",
      headers,
      JSON.stringify(update)
    );
    if (result.status >= 400) {
      const text = typeof result.data === "string" ? result.data : "";
      // FastAPI wire-encodes HTTPException(detail=...) as
      // `{"detail": "..."}`. Unwrap so the dialog renders the human
      // message, not the JSON envelope.
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (parsed && typeof parsed.detail === "string") {
          detail = parsed.detail;
        }
      } catch {
        // not JSON; fall through with raw text
      }
      const err = new Error(detail || `HTTP ${result.status}`) as Error & {
        code?: number;
      };
      err.code = result.status;
      throw err;
    }
    const text = typeof result.data === "string" ? result.data : "";
    const log: unknown = JSON.parse(text);
    const etag = result.headers.get("ETag") ?? undefined;
    return JSON.stringify({ log, etag });
  }

  /**
   * Best-effort identity of the user editing logs (git user.name →
   * user.email → OS login), forwarded from `/api/user-info`. Returns
   * an empty object on older inspect_ai versions where the endpoint
   * doesn't exist (404) so the dialog just leaves Author blank.
   */
  public async getUserInfo(): Promise<string> {
    if (!this.haveInspectEvalLogFormat()) {
      return JSON.stringify({});
    }
    const result = await this.api_json(
      "/api/user-info",
      "GET",
      undefined,
      (status) => (status === 404 ? JSON.stringify({}) : undefined)
    );
    return result.data;
  }

  /**
   * Installed inspect / scout versions, forwarded from `/api/app-config`.
   * Older inspect_ai versions lack the endpoint (404) — return a placeholder
   * so the viewer's startup config gate still resolves and renders.
   */
  public async getAppConfig(): Promise<string> {
    const fallback = JSON.stringify({
      inspect_version: "unknown",
      scout_version: null,
    });
    if (!this.haveInspectEvalLogFormat()) {
      return fallback;
    }
    const result = await this.api_json(
      "/api/app-config",
      "GET",
      undefined,
      (status) => (status === 404 ? fallback : undefined)
    );
    return result.data;
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

  async getDistPath(): Promise<AbsolutePath | null> {
    const result = await this.api_json(
      "/api/dist",
      "GET",
      undefined,
      (status: number) => (status === 404 ? "null" : undefined)
    );
    if (result.data === "null") {
      return null;
    }
    const { path } = JSON.parse(result.data) as { path: string };
    return toAbsolutePath(path);
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
        files: logsJson.map((log) => ({
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
