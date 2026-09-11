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
 *
 * Locations are extracted the way the server will interpret them: a
 * `/{name:path}` catch-all receives the whole percent-decoded remainder of the
 * path (not just its first segment), and a v2 `<dir>/<scan>` pair is joined the
 * way `UPath(dir) / scan` joins it (an absolute `scan` replaces `dir`).
 */

import { parseProxyRequest } from "./proxy-request";
import { assertScanConfigInScope, ScanConfigScope } from "./scan-config-scope";
import type { HttpProxyRpcRequest } from "./view-server";

type InScope = (location: string) => boolean;

interface ParsedRequest {
  pathname: string;
  params: URLSearchParams;
  /** Path split on "/", each segment percent-decoded (index 0 is ""). */
  segments: string[];
  /**
   * The percent-decoded remainder of the path after `prefix` — what a
   * `{name:path}` catch-all route receives on the server. `prefix` must end
   * with "/" (e.g. "/api/log-bytes/").
   */
  remainder: (prefix: string) => string;
}

function parseRequest(request: HttpProxyRpcRequest): ParsedRequest {
  try {
    const path = parseProxyRequest(request).path;
    // Runtime validation requires an absolute /api/ path.
    const url = new URL("http://127.0.0.1" + path);
    const segments = url.pathname
      .split("/")
      .map((segment, index) =>
        index === 0 ? segment : decodeURIComponent(segment)
      );
    return {
      pathname: url.pathname,
      params: url.searchParams,
      segments,
      remainder: (prefix) =>
        segments.slice(prefix.split("/").length - 1).join("/"),
    };
  } catch {
    throw proxyError(request);
  }
}

function checker(request: HttpProxyRpcRequest, inScope: InScope) {
  return (location: string | null | undefined): void => {
    if (typeof location !== "string" || !inScope(location)) {
      throw proxyError(request);
    }
  };
}

/**
 * Decode a base64url segment, refusing non-canonical input. Node's decoder is
 * lenient (it drops invalid characters and accepts the standard alphabet) and
 * the Python server's `urlsafe_b64decode` is lenient in its own way, so only a
 * value that round-trips exactly is accepted — that removes any room for the
 * two decoders to disagree about which location was requested. Padding is
 * optional (the viewers emit none).
 */
function decodeBase64Url(value: string, request: HttpProxyRpcRequest): string {
  const decoded = Buffer.from(value, "base64url").toString("utf-8");
  const canonical = Buffer.from(decoded, "utf-8").toString("base64url");
  if (canonical !== value.replace(/=+$/, "")) {
    throw proxyError(request);
  }
  return decoded;
}

/** Whether a decoded path/URI would replace (rather than extend) a base dir when joined. */
function isAbsoluteLocation(location: string): boolean {
  return (
    location.startsWith("/") ||
    location.startsWith("\\") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(location)
  );
}

function joinLocation(dir: string, child: string): string {
  return isAbsoluteLocation(child)
    ? child
    : dir.replace(/\/+$/, "") + "/" + child.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Inspect log view
// ---------------------------------------------------------------------------

// Endpoints that carry no file/dir location.
const kLogNoLocation = new Set([
  "/api/user-info",
  "/api/app-config",
  "/api/events", // last_eval_time only
  "/api/dist",
  "/api/scout/searches", // type + count only
]);

const kLogDirectoryRoutes = new Set([
  "/api/log-dir",
  "/api/logs",
  "/api/log-files",
  "/api/eval-set",
  "/api/flow",
]);

/** The shared server's default directory is not authority for this panel. */
export function bindLogProxyDefault(
  request: HttpProxyRpcRequest,
  directory?: string
): HttpProxyRpcRequest {
  const { pathname, params } = parseRequest(request);
  if (!kLogDirectoryRoutes.has(pathname) || params.has("log_dir"))
    return request;
  if (!directory) throw proxyError(request);
  params.set("log_dir", directory);
  return { ...request, path: `${pathname}?${params.toString()}` };
}

// Endpoints of the form /api/<name>/{log:path}. `log-delete` is deliberately
// absent: neither the named RPC surface nor the viewer deletes logs, so the
// proxy must not either.
const kLogSegmentRoutes = [
  "/api/logs/",
  "/api/log-info/",
  "/api/log-size/",
  "/api/log-bytes/",
  "/api/log-download/",
  "/api/log-edit/",
  "/api/log-message/",
];

/**
 * Throw unless the proxied Inspect **log** view request stays within the panel
 * scope. `inScope` is the panel's `logPathInScope` bound to its file/dir scope.
 */
export function assertLogProxyInScope(
  request: HttpProxyRpcRequest,
  inScope: InScope
): void {
  const { pathname, params, segments, remainder } = parseRequest(request);
  const check = checker(request, inScope);

  const logMethod =
    pathname === "/api/log-message" || pathname.startsWith("/api/log-edit/")
      ? "POST"
      : "GET";
  const searchPost = /^\/api\/scout\/transcripts\/[^/]+\/[^/]+\/search$/.test(
    pathname
  );
  if (request.method !== (searchPost ? "POST" : logMethod))
    throw proxyError(request);

  if (kLogNoLocation.has(pathname)) {
    return;
  }

  // Defaults must already be bound to the panel. Check every repeated value
  // because FastAPI selects the last scalar parameter.
  if (
    pathname === "/api/log-dir" ||
    pathname === "/api/logs" ||
    pathname === "/api/log-files"
  ) {
    if (!params.has("log_dir")) throw proxyError(request);
    params.getAll("log_dir").forEach(check);
    return;
  }
  if (
    pathname === "/api/pending-samples" ||
    pathname === "/api/pending-sample-data" ||
    pathname === "/api/pending-sample-data-urls"
  ) {
    if (!params.has("log")) throw proxyError(request);
    params.getAll("log").forEach(check);
    return;
  }
  if (pathname === "/api/log-message") {
    // POST form: the log file is the `log_file` query parameter.
    if (!params.has("log_file")) throw proxyError(request);
    params.getAll("log_file").forEach(check);
    return;
  }
  if (pathname === "/api/log-headers") {
    // Each requested file must be in scope; an empty request is a no-op.
    params.getAll("file").forEach(check);
    return;
  }
  // eval-set / flow resolve a directory from log_dir (+ an optional `dir`
  // subdirectory joined onto it); confine every effective directory the
  // server could resolve from the supplied values.
  if (pathname === "/api/eval-set" || pathname === "/api/flow") {
    const bases = params.getAll("log_dir");
    if (!bases.length) throw proxyError(request);
    const subs = params.getAll("dir");
    if (bases.length > 0 && subs.length > 0) {
      for (const base of bases) {
        for (const sub of subs) {
          check(joinLocation(base, sub));
        }
      }
    } else {
      bases.forEach(check);
      subs.forEach(check);
    }
    return;
  }

  const segmentRoute = kLogSegmentRoutes.find((route) =>
    pathname.startsWith(route)
  );
  if (segmentRoute) {
    return check(remainder(segmentRoute));
  }

  // /api/scout/transcripts/<base64url dir>/<id>/...
  if (pathname.startsWith("/api/scout/transcripts/")) {
    const dirSegment = segments[4];
    if (!dirSegment) {
      throw proxyError(request);
    }
    return check(decodeBase64Url(dirSegment, request));
  }

  throw proxyError(request);
}

// ---------------------------------------------------------------------------
// Scout scan view
// ---------------------------------------------------------------------------

// No-location endpoints, after the explicit project permission checks below.
const kScanNoLocation = new Set([
  "/api/v2/dist",
  "/api/v2/app-config",
  "/api/v2/project/config",
  "/api/v2/topics",
  "/api/v2/topics/stream",
  "/api/v2/scanners",
  "/api/v2/code",
  "/api/v2/searches",
  "/api/v2/scans/active",
  "/api/v2/startscan",
  "/api/v2/validations",
]);

// Legacy /api/<name>/{location:path}. `scan-delete` is deliberately absent:
// the viewer never deletes scans through the proxy.
const kLegacyScanSegmentRoutes = [
  "/api/scan/",
  "/api/scanner_df/",
  "/api/scanner_df_input/",
];

/**
 * Throw unless the proxied **scan** view request stays within the panel scope.
 *
 * `inScope` is the panel's `scanLocationInScope` bound to its scan scope.
 * `inTranscriptsScope` governs the transcripts routes: the viewer reads
 * transcripts from the project's configured transcripts location (which is
 * usually NOT under the scan results dir), so callers pass a predicate bound
 * to that location. It defaults to `inScope`.
 */
export function assertScanProxyInScope(
  request: HttpProxyRpcRequest,
  inScope: InScope,
  inTranscriptsScope: InScope = inScope,
  permissions: { fullView: boolean; configScope?: ScanConfigScope } = {
    fullView: false,
  }
): void {
  const { pathname, params, segments, remainder } = parseRequest(request);
  const check = checker(request, inScope);

  const methods = scanRouteMethods(pathname);
  if (!methods.includes(request.method)) throw proxyError(request);
  // Validation files and their index belong to the project, not this scan.
  if (!permissions.fullView && pathname.startsWith("/api/v2/validations"))
    throw proxyError(request);
  const projectMutation =
    pathname === "/api/v2/startscan" ||
    (pathname === "/api/v2/project/config" && request.method === "PUT") ||
    (pathname.startsWith("/api/v2/validations") && request.method !== "GET");
  if (projectMutation && !permissions.fullView) throw proxyError(request);
  if (
    pathname === "/api/v2/startscan" ||
    (pathname === "/api/v2/project/config" && request.method === "PUT")
  ) {
    if (!permissions.configScope) throw proxyError(request);
    assertScanConfigInScope(request.body, permissions.configScope);
    return;
  }
  if (pathname.startsWith("/api/v2/validations/")) return;
  if (!permissions.fullView && pathname === "/api/v2/scans/active")
    throw proxyError(request);
  if (kScanNoLocation.has(pathname)) return;

  // Legacy scan listing: with no results_dir it lists the server default; with
  // one it must be in scope.
  if (pathname === "/api/scans") {
    if (!permissions.fullView) throw proxyError(request);
    params.getAll("results_dir").forEach(check);
    return;
  }

  const legacyRoute = kLegacyScanSegmentRoutes.find((route) =>
    pathname.startsWith(route)
  );
  if (legacyRoute) {
    return check(remainder(legacyRoute));
  }

  // /api/v2/transcripts/<base64url dir>/<id>/...  — <id> is a transcript id
  // (a database key), not a path.
  if (pathname.startsWith("/api/v2/transcripts/")) {
    const dirSegment = segments[4];
    if (!dirSegment) {
      throw proxyError(request);
    }
    return checker(
      request,
      inTranscriptsScope
    )(decodeBase64Url(dirSegment, request));
  }

  // /api/v2/scans/<base64url dir>[/<base64url scan>[/<scanner>/...]] (plus the
  // literal /api/v2/scans/<dir>/distinct). The server resolves the scan as
  // `UPath(dir) / scan`, so an absolute or traversing <scan> escapes <dir>;
  // check the effective joined location, not just <dir>.
  if (pathname.startsWith("/api/v2/scans/")) {
    const dirSegment = segments[4];
    if (!dirSegment) {
      throw proxyError(request);
    }
    const dir = decodeBase64Url(dirSegment, request);
    const scanSegment = segments[5];
    if (scanSegment && scanSegment !== "distinct") {
      check(joinLocation(dir, decodeBase64Url(scanSegment, request)));
    } else {
      if (!permissions.fullView) throw proxyError(request);
      check(dir);
    }
    return;
  }

  throw proxyError(request);
}

function scanRouteMethods(pathname: string): string[] {
  if (/^\/api\/v2\/transcripts\/[^/]+\/[^/]+\/info$/.test(pathname))
    return ["GET", "HEAD"];
  if (pathname === "/api/v2/project/config") return ["GET", "PUT"];
  if (pathname === "/api/v2/startscan" || pathname === "/api/v2/code")
    return ["POST"];
  if (pathname === "/api/v2/validations") return ["GET", "POST"];
  if (/^\/api\/v2\/validations\/[^/]+$/.test(pathname))
    return ["GET", "DELETE"];
  if (/^\/api\/v2\/validations\/[^/]+\/rename$/.test(pathname)) return ["PUT"];
  if (/^\/api\/v2\/validations\/[^/]+\/[^/]+$/.test(pathname))
    return ["GET", "POST", "DELETE"];
  if (
    kScanNoLocation.has(pathname) ||
    pathname === "/api/scans" ||
    kLegacyScanSegmentRoutes.some((route) => pathname.startsWith(route))
  )
    return ["GET"];
  if (/^\/api\/v2\/(scans|transcripts)\/[^/]+(?:\/distinct)?$/.test(pathname))
    return ["POST"];
  if (/^\/api\/v2\/scans\/[^/]+\/[^/]+(?:\/[^/]+){0,2}$/.test(pathname))
    return ["GET"];
  if (/^\/api\/v2\/transcripts\/[^/]+\/[^/]+\/search$/.test(pathname))
    return ["POST"];
  if (
    /^\/api\/v2\/transcripts\/[^/]+\/[^/]+\/(?:info|messages-events|searches\/[^/]+)$/.test(
      pathname
    )
  )
    return ["GET"];
  return [];
}

function proxyError(request: HttpProxyRpcRequest): Error {
  return new Error(
    `Refusing proxied request ${request.method} "${request.path}": outside the scope of this view.`
  );
}
