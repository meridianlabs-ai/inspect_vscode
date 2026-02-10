import { Uri } from "vscode";

/**
 * Message sent to the webview to control navigation and display mode.
 *
 * The webview decodes this message and uses it for two purposes:
 * 1. Mode selection - "full" displays the complete application including the
 *    activity bar, while "single-file" shows a reduced view without the
 *    full application chrome.
 * 2. Navigation - The route is processed to navigate the view to the
 *    specified location within the application.
 */
export interface RouteMessage {
  type: "updateRoute";
  route: string;
  mode: "full" | "single-file";
  extensionProtocolVersion: number;
}

export function viewScanRouteMessage(
  scanDir: Uri,
  scanJob?: string,
  scannerName?: string
) {
  const route = scanJob
    ? getScanRoute(scanDir, scanJob, scannerName)
    : getScansRoute(scanDir);

  return routeStateMessage(route, "single-file");
}

export function viewRouteMessage(
  route: "scans" | "transcripts" | "validation" | "project"
) {
  return routeStateMessage(`/${route}`, "full");
}

const routeStateMessage = (
  route: string,
  mode: "full" | "single-file"
): RouteMessage => {
  const stateMsg: RouteMessage = {
    type: "updateRoute",
    route,
    mode,
    extensionProtocolVersion: 2,
  };
  return stateMsg;
};

const getScanRoute = (
  scanDir: Uri,
  scanJob: string,
  scanner?: string
): string => {
  const base64ScanDir = Buffer.from(scanDir.toString()).toString("base64");
  const urlEncodedScanJobName = encodeURIComponent(scanJob);
  const urlEncodedScannerName = scanner
    ? encodeURIComponent(scanner)
    : undefined;

  const route = `/scan/${base64ScanDir}/${urlEncodedScanJobName}${urlEncodedScannerName ? `?scanner=${urlEncodedScannerName}` : ""}`;
  return route;
};

const getScansRoute = (scanDir: Uri): string => {
  const base64ScanDir = Buffer.from(scanDir.toString()).toString("base64");
  return `/scan/${base64ScanDir}`;
};
