import { Uri } from "vscode";

import {
  directoryViewPathScope,
  fileViewPathScope,
  pathIsInViewScope,
  ViewPathScope,
} from "../../core/uri";

export interface LogviewState {
  log_file?: Uri;
  log_dir: Uri;
  scope_kind?: "directory" | "file";
  path_scope?: ViewPathScope;
  sample?: {
    id: string;
    epoch: string;
  };
  background_refresh?: boolean;
}

export function logviewPathScope(state: LogviewState): ViewPathScope {
  if (state.path_scope) {
    return state.path_scope;
  }
  const kind = state.scope_kind ?? (state.log_file ? "file" : "directory");
  return kind === "file"
    ? fileViewPathScope(state.log_file ?? state.log_dir)
    : directoryViewPathScope(state.log_dir);
}

export async function logFileIsInLogviewScope(
  scope: ViewPathScope,
  logFile: Uri
): Promise<boolean> {
  return await pathIsInViewScope(scope, logFile);
}
