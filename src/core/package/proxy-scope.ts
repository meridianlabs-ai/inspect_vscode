import type { HttpProxyRpcRequest } from "./view-server";

/**
 * Scope confinement for the generic `http_request` proxy exposed to the log and
 * scan webviews.
 *
 * The named RPC methods each wrap their location parameter in a scope guard
 * (`logPathInScope` / `scanLocationInScope`), because the backing view server is
 * token-authorized and reads/writes ANY path or URL by design. The proxy would
 * otherwise forward an arbitrary webview-supplied request to that same server
 * with the auth token attached, bypassing every guard. So the proxy is confined
 * here: the requested view-server route is parsed, any file/dir/URL location it
 * carries is extracted and checked against the panel scope, and unrecognized
 * routes are rejected by default. See CWE-863.
 */

type InScope = (location: string) => boolean;

interface ParsedPath {
  pathname: string;
  params: URLSearchParams;
  /** Path split on "/", each segment percent-decoded (index 0 is ""). */
  segments: string[];
}

function parsePath(path: string): ParsedPath {
  // The view server only serves absolute "/api/..." paths; normalize so a
  // missing leading slash still parses rather than being treated as relative.
  const url = new URL(
    "http://127.0.0.1" + (path.startsWith("/") ? path : "/" + path)
  );
  const segments = url.pathname
    .split("/")
    .map((segment, index) =>
      index === 0 ? segment : decodeURIComponent(segment)
    );
  return { pathname: url.pathname, params: url.searchParams, segments };
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf-8");
}

/**
 * Throw unless the proxied Inspect **log** view request stays within the panel
 * scope. `inScope` is the panel's `logPathInScope` bound to its file/dir scope.
 */
export function assertLogProxyInScope(
  request: HttpProxyRpcRequest,
  inScope: InScope
): void {
  let parsed: ParsedPath;
  try {
    parsed = parsePath(request.path);
  } catch {
    throw proxyError(request.path);
  }
  const { pathname, params, segments } = parsed;
  const check = (location: string | null | undefined) => {
    if (typeof location !== "string" || !inScope(location)) {
      throw proxyError(request.path);
    }
  };

  // Endpoints that carry no file/dir location.
  const kNoLocation = new Set([
    "/api/log-dir",
    "/api/user-info",
    "/api/app-config",
    "/api/dist",
    "/api/scout/searches", // type + count only
  ]);
  if (kNoLocation.has(pathname)) {
    return;
  }

  // Endpoints whose location is a query parameter. A missing location means the
  // server lists/uses its own configured default (not an attacker-chosen path),
  // which the viewer requests during config load — allow it; only enforce scope
  // when a location is actually supplied.
  if (pathname === "/api/logs" || pathname === "/api/log-files") {
    const logDir = params.get("log_dir");
    if (logDir) {
      check(logDir);
    }
    return;
  }
  if (
    pathname === "/api/pending-samples" ||
    pathname === "/api/pending-sample-data"
  ) {
    const logParam = params.get("log");
    if (logParam) {
      check(logParam);
    }
    return;
  }
  if (pathname === "/api/log-headers") {
    // Each requested file must be in scope; an empty request is a no-op.
    params.getAll("file").forEach(check);
    return;
  }

  // Endpoints of the form /api/<name>/<encoded location>.
  const kSegmentRoutes = [
    "/api/logs/",
    "/api/log-size/",
    "/api/log-delete/",
    "/api/log-bytes/",
    "/api/log-edit/",
    "/api/log-message/",
  ];
  if (kSegmentRoutes.some((route) => pathname.startsWith(route))) {
    return check(segments[3]);
  }

  // /api/scout/transcripts/<base64url dir>/<id>/...
  if (pathname.startsWith("/api/scout/transcripts/")) {
    const dirSegment = segments[4];
    if (!dirSegment) {
      throw proxyError(request.path);
    }
    return check(decodeBase64Url(dirSegment));
  }

  throw proxyError(request.path);
}

/**
 * Throw unless the proxied **scan** view request stays within the panel scope.
 * `inScope` is the panel's `scanLocationInScope` bound to its scan scope.
 */
export function assertScanProxyInScope(
  request: HttpProxyRpcRequest,
  inScope: InScope
): void {
  let parsed: ParsedPath;
  try {
    parsed = parsePath(request.path);
  } catch {
    throw proxyError(request.path);
  }
  const { pathname, params, segments } = parsed;
  const check = (location: string | null | undefined) => {
    if (typeof location !== "string" || !inScope(location)) {
      throw proxyError(request.path);
    }
  };

  if (pathname === "/api/v2/dist") {
    return;
  }

  // Scan listing: with no results_dir it lists the server default; with one it
  // must be in scope.
  if (pathname === "/api/scans") {
    const resultsDir = params.get("results_dir");
    if (resultsDir) {
      return check(resultsDir);
    }
    return;
  }

  // /api/<name>/<encoded location> (plain URI/path segment).
  const kSegmentRoutes = [
    "/api/scan/",
    "/api/scanner_df/",
    "/api/scanner_df_input/",
    "/api/scan-delete/",
  ];
  if (kSegmentRoutes.some((route) => pathname.startsWith(route))) {
    return check(segments[3]);
  }

  // /api/v2/scans/<base64 dir>[/<base64 file>] — the dir is the scope-bearing part.
  if (pathname.startsWith("/api/v2/scans/")) {
    const dirSegment = segments[4];
    if (!dirSegment) {
      throw proxyError(request.path);
    }
    return check(decodeBase64(dirSegment));
  }

  throw proxyError(request.path);
}

function proxyError(path: string): Error {
  return new Error(
    `Refusing proxied request to "${path}": outside the scope of this view.`
  );
}
