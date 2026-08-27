import { Uri } from "vscode";

export interface LogviewState {
  log_file?: Uri;
  log_dir: Uri;
  sample?: {
    id: string;
    epoch: string;
  };
  background_refresh?: boolean;
  // Authorization scope for the webview's file-content RPC surface. "file"
  // confines the panel to log_file (the legacy single-file open path); "dir"
  // (the default) confines it to descendants of log_dir.
  scopeType?: "file" | "dir";
}
