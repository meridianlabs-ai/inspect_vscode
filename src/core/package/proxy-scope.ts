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
 *
 * Locations are extracted the way the server will interpret them: a
 * `/{name:path}` catch-all receives the whole percent-decoded remainder of the
 * path (not just its first segment), and a v2 `<dir>/<scan>` pair is joined the
 * way `UPath(dir) / scan` joins it (an absolute `scan` replaces `dir`).
 */

type InScope = (location: string) => boolean;

interface ParsedRequest {
  url: URL;
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
    const path = request.path;
    // Callers validate the request first (`parseProxyRequest`), so the path is
    // already absolute. Refuse rather than repair anything else: a relative
    // path would otherwise be parsed as part of the host.
    if (!path.startsWith("/")) {
      throw proxyError(request);
    }
    const url = new URL("http://127.0.0.1" + path);
    const segments = url.pathname
      .split("/")
      .map((segment, index) =>
        index === 0 ? segment : decodeURIComponent(segment)
      );
    return {
      url,
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
    // An empty location is never a request for something in the panel scope;
    // the server treats it as a real value (some routes as "use the default
    // dir"), so refuse it here rather than leave it to the predicate's
    // resolution of "" against the extension host's working directory.
    if (typeof location !== "string" || location === "" || !inScope(location)) {
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
  "/api/log-dir",
  "/api/user-info",
  "/api/app-config",
  "/api/events", // last_eval_time only
  "/api/dist",
  "/api/scout/searches", // type + count only
]);

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

// Query-parameter routes on which an ABSENT `log_dir` makes the server fall
// back to its own configured default directory (`inspect view start`'s log
// dir: the workspace `./logs` or INSPECT_LOG_DIR). That directory is chosen by
// the server, not by the panel, so no panel scope vouches for it.
const kLogDefaultDirRoutes = new Set([
  "/api/logs",
  "/api/log-files",
  "/api/eval-set",
  "/api/flow",
]);

/**
 * Bind a proxied Inspect **log** view request that omits its `log_dir` to the
 * panel's own location, so the server never resolves its default directory on
 * the panel's behalf.
 *
 * The viewer's directory-mode bootstrap probe is a bare `GET /api/logs`, which
 * the server answers with a listing of its default directory. A `file` panel
 * may only see its one log and a `dir` panel opened on some other directory
 * may not see this one, so the panel fills in what the probe was really asking
 * for: a `dir` panel lists its own directory, and a `file` panel names its log
 * file, which the server lists as a single-file listing on both routes (the
 * same answer the named `eval_logs` method gives such a panel). `/api/eval-set`
 * and `/api/flow` resolve their manifest under the same default, so they are
 * bound the same way. A request that already carries a `log_dir` is returned
 * unchanged; {@link assertLogProxyInScope} checks it rather than rewriting it.
 *
 * `location` is the panel's log file or directory as a URI string, the form
 * the named methods send. The path is rebuilt from its parsed form so a
 * fragment can never swallow the appended parameter (fetch drops fragments).
 */
export function bindLogProxyDefaultLocation(
  request: HttpProxyRpcRequest,
  location: string
): HttpProxyRpcRequest {
  const { url, pathname, params } = parseRequest(request);
  if (!kLogDefaultDirRoutes.has(pathname) || params.has("log_dir")) {
    return request;
  }
  url.searchParams.append("log_dir", location);
  return { ...request, path: url.pathname + url.search };
}

/**
 * Throw unless the proxied Inspect **log** view request stays within the panel
 * scope. `inScope` is the panel's `logPathInScopeAllowingEncoded` bound to its
 * file/dir scope. Callers bind a bare `log_dir` to the panel location first
 * ({@link bindLogProxyDefaultLocation}); this check refuses one that is still
 * absent.
 */
export function assertLogProxyInScope(
  request: HttpProxyRpcRequest,
  inScope: InScope
): void {
  // No log-view route needs DELETE, so refuse it outright.
  if (request.method === "DELETE") {
    throw proxyError(request);
  }

  const { pathname, params, segments, remainder } = parseRequest(request);
  const check = checker(request, inScope);

  if (kLogNoLocation.has(pathname)) {
    return;
  }

  // Endpoints whose location is a query parameter. Every supplied value is
  // checked, including empty ones (the server treats "" as a real location or
  // as the default, never as "nothing") and repeats (FastAPI resolves a
  // repeated scalar parameter to the LAST value, so validating only the first
  // would be a bypass). An ABSENT `log_dir` on the listing routes is refused:
  // the server would list its own default directory, which the panel scope
  // does not vouch for (a single-file panel would see every log in it). The
  // panel binds the parameter to its own location before this check, so a
  // bare request arriving here skipped that step.
  if (pathname === "/api/logs" || pathname === "/api/log-files") {
    const dirs = params.getAll("log_dir");
    if (dirs.length === 0) {
      throw proxyError(request);
    }
    dirs.forEach(check);
    return;
  }
  if (
    pathname === "/api/pending-samples" ||
    pathname === "/api/pending-sample-data" ||
    pathname === "/api/pending-sample-data-urls"
  ) {
    params.getAll("log").forEach(check);
    return;
  }
  if (pathname === "/api/log-message") {
    // POST form: the log file is the `log_file` query parameter.
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
  // server could resolve from the supplied values. Without a log_dir the
  // server would join `dir` onto its default directory, so refuse that too.
  if (pathname === "/api/eval-set" || pathname === "/api/flow") {
    const bases = params.getAll("log_dir");
    const subs = params.getAll("dir");
    if (bases.length === 0) {
      throw proxyError(request);
    }
    if (subs.length > 0) {
      for (const base of bases) {
        for (const sub of subs) {
          check(joinLocation(base, sub));
        }
      }
    } else {
      bases.forEach(check);
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

// No-location config/listing/compute endpoints.
//
// NOTE: `/startscan` (POST) and `/project/config` (PUT) are mutating endpoints
// whose request BODY carries free-form locations (transcripts, scans/results,
// scanner source files) that the scout server does not confine to the project.
// They are allowed because the Scout View's "start scan" and "edit project"
// features are built on them; this leaves those two operations reachable from
// injected webview script. Scoping them would require parsing the body.
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
  inTranscriptsScope: InScope = inScope
): void {
  const { pathname, params, segments, remainder } = parseRequest(request);
  const check = checker(request, inScope);

  // Validation sets/cases are files in the project dir, confined server-side
  // (`_validate_path_within_project`), and the viewer creates, renames and
  // deletes them. They are not scan results, so the scan scope does not apply.
  if (pathname.startsWith("/api/v2/validations/")) {
    return;
  }

  // Nothing else needs DELETE: the viewer never deletes scans through the
  // proxy (the extension's own tree commands call the server directly).
  if (request.method === "DELETE") {
    throw proxyError(request);
  }

  if (kScanNoLocation.has(pathname)) {
    return;
  }

  // Legacy scan listing: with no results_dir it lists the server default; with
  // one it must be in scope.
  if (pathname === "/api/scans") {
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
    check(dir);
    const scanSegment = segments[5];
    if (scanSegment && scanSegment !== "distinct") {
      check(joinLocation(dir, decodeBase64Url(scanSegment, request)));
    }
    return;
  }

  throw proxyError(request);
}

function proxyError(request: HttpProxyRpcRequest): Error {
  return new Error(
    `Refusing proxied request ${request.method} "${request.path}": outside the scope of this view.`
  );
}
