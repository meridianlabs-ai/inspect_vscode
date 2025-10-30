import { Uri } from "vscode";

export interface ScanviewState {
  scan_dir?: Uri;
  results_dir: Uri;
  scan?: {
    scanner: string;
    transcript_id: string;
  };
  background_refresh?: boolean;
}
