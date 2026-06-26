import { Uri } from "vscode";

export interface LogviewState {
  log_file?: Uri;
  log_dir: Uri;
  scope_kind?: "directory" | "file";
  sample?: {
    id: string;
    epoch: string;
  };
  background_refresh?: boolean;
}
