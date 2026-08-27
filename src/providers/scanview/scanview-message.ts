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

// Grammar of routes the extension itself produces:
//   /scans | /transcripts | /validation | /project
//   /scan/<base64>[/<url-encoded-job>][?scanner=<url-encoded>]
// The character classes deliberately exclude HTML/whitespace metacharacters so
// a restored route can never carry markup even before serialization.
const kRouteGrammar =
  /^\/(?:scans|transcripts|validation|project|scan\/[A-Za-z0-9+/=]+(?:\/[A-Za-z0-9%._~-]+)?(?:\?scanner=[A-Za-z0-9%._~-]+)?)$/;

/**
 * Validate/normalize a RouteMessage before it is embedded in the webview HTML.
 *
 * The panel serializer restores this message from state the (untrusted) webview
 * persisted via setState(). This checks the message shape and constrains the
 * route's characters to the grammar the extension itself produces, so a restored
 * route can't carry markup into the embedded state; anything else is replaced
 * with a safe default route. It does NOT decode or authorize the base64 scan
 * directory inside a /scan route — which location a scan may actually be read
 * from is enforced by the per-request RPC scope check (scanLocationInScope),
 * not by this grammar.
 */
export function sanitizeRouteMessage(message: unknown): RouteMessage {
  const fallback = viewRouteMessage("scans");
  if (typeof message !== "object" || message === null) {
    return fallback;
  }
  const m = message as Record<string, unknown>;
  if (
    m.type !== "updateRoute" ||
    (m.mode !== "full" && m.mode !== "single-file") ||
    typeof m.route !== "string" ||
    !kRouteGrammar.test(m.route)
  ) {
    return fallback;
  }
  return {
    type: "updateRoute",
    route: m.route,
    mode: m.mode,
    extensionProtocolVersion:
      typeof m.extensionProtocolVersion === "number"
        ? m.extensionProtocolVersion
        : 2,
  };
}
