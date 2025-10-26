import { Uri } from "vscode";

export interface ScanviewState {
  scan_dir?: Uri;
  results_dir: Uri;
  background_refresh?: boolean;
}
