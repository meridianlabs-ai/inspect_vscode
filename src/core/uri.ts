import * as os from "os";
import path from "path";

import { Uri } from "vscode";

export function resolveToUri(pathOrUri: string): Uri {
  if (isUri(pathOrUri)) {
    try {
      return Uri.parse(pathOrUri);
    } catch (error) {
      throw new Error(`Invalid URI format: ${pathOrUri}`, { cause: error });
    }
  } else {
    try {
      const absolutePath = path.isAbsolute(pathOrUri)
        ? pathOrUri
        : path.resolve(pathOrUri);
      return Uri.file(absolutePath);
    } catch (error) {
      throw new Error(`Invalid file path: ${pathOrUri}`, { cause: error });
    }
  }
}

/**
 * Percent-decode a location once, the way the Inspect view server does
 * (`urllib.parse.unquote`): every well-formed `%XX` escape becomes its byte, a
 * malformed escape (`%zz`, or a `%` followed by fewer than two hex digits) is
 * kept literally, and the bytes are read as UTF-8. Returns null when the
 * decoded bytes are not valid UTF-8; Python substitutes U+FFFD there, which
 * names no real location, so callers refuse rather than guess.
 *
 * `ignoreBOM` keeps a decoded U+FEFF (`%EF%BB%BF`) as the file-name character
 * it is. By default TextDecoder drops that byte sequence at the start of each
 * decode, and each `%XX` run is decoded separately, so `logs/%EF%BB%BFrun.eval`
 * would come back as `logs/run.eval` while `unquote` names the distinct file
 * `logs/\uFEFFrun.eval`.
 */
export function percentDecodeOnce(value: string): string | null {
  if (!value.includes("%")) {
    return value;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
      decoder.decode(Buffer.from(run.replace(/%/g, ""), "hex"))
    );
  } catch {
    return null;
  }
}

/**
 * Parse a location string literally, as the filesystem will see it: a `%` in a
 * URI is the character `%` of a file name, not the start of an escape.
 * `Uri.parse` would decode `%XX` sequences, making `run%201.eval` and
 * `run 1.eval` the same path; escaping every `%` first makes that decode a
 * no-op. Bare paths are resolved as {@link resolveToUri} resolves them
 * (`Uri.file` already keeps `%` literal).
 */
export function parseLocationLiterally(location: string): Uri {
  return isUri(location)
    ? Uri.parse(location.replace(/%/g, "%25"))
    : resolveToUri(location);
}

export function dirname(uri: Uri): Uri {
  if (uri.scheme === "file") {
    // Handle file URIs
    const parentPath = path.dirname(uri.fsPath);
    return Uri.file(parentPath);
  } else {
    // Handle non-file URIs
    const parsedUrl = new URL(uri.toString());
    parsedUrl.pathname = path.dirname(parsedUrl.pathname);
    return Uri.parse(parsedUrl.toString());
  }
}

export function basename(uri: Uri): string {
  if (uri.scheme === "file") {
    return path.basename(uri.fsPath);
  } else {
    const parsedUrl = new URL(uri.toString());
    return path.basename(parsedUrl.pathname);
  }
}

export function prettyUriPath(uri: Uri): string {
  if (uri.scheme === "file") {
    const fsPath = uri.fsPath;
    const home = os.homedir();
    // On Windows, drive letters can differ in case between os.homedir() and
    // the URI fsPath. Use a case-insensitive replace.
    if (os.platform() === "win32") {
      const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return fsPath.replace(new RegExp(escapedHome, "i"), "~");
    }
    return fsPath.replace(home, "~");
  } else {
    return uri.toString(true);
  }
}

/**
 * Gets the relative path from a parent Uri to a child Uri.
 * Returns null if child is not a strict descendant of parent.
 *
 * This is a containment predicate other code relies on for security
 * boundaries, so it must be exact:
 *   - a raw `startsWith` on the full URI treats a sibling that merely shares a
 *     string prefix as contained ('.../logs' vs '.../logs-evil/x'), so the
 *     comparison is made against the parent path with a trailing '/' boundary;
 *   - unresolved '..'/'.' segments let a child escape the parent while still
 *     sharing its prefix ('.../logs/../../etc/x'), so both paths are normalized
 *     before comparison and the returned relative can never contain '..'.
 * For non-file schemes the authority (S3 bucket, host) is part of the identity,
 * so a differing authority is never contained.
 */
export function getRelativeUri(parentUri: Uri, childUri: Uri): string | null {
  if (parentUri.scheme !== childUri.scheme) {
    return null;
  }
  if (parentUri.authority !== childUri.authority) {
    return null;
  }

  // Resolve '.'/'..' on the URI path components (always '/'-separated and
  // decoded), so traversal cannot escape the parent under a shared prefix.
  // Backslash is a path separator for downstream Windows consumers (fsPath, the
  // Python view server) but not for path.posix, so a child like
  // `.../logs/..\..\x` would otherwise pass the '/'-only segment check and then
  // escape the directory on Windows. Fold '\' to '/' before normalizing so the
  // containment check matches the downstream interpretation. See CWE-29.
  // On Windows a drive letter is case-insensitive, and the two ways a file Uri
  // is built spell it differently: `Uri.file("C:\\w\\logs")` keeps the path
  // `/C:/w/logs`, while `Uri.parse` of that Uri's own `toString()` yields
  // `/c:/w/logs` (toString lower-cases the drive). The same directory must
  // contain itself whichever way it arrived, so fold the drive letter there.
  // Only there: on POSIX `/c:` is an ordinary, case-sensitive directory name.
  const foldDrive = (p: string): string =>
    os.platform() === "win32" && parentUri.scheme === "file"
      ? p.replace(
          /^\/([a-zA-Z]):/,
          (_, drive: string) => `/${drive.toLowerCase()}:`
        )
      : p;
  const parentPath = foldDrive(
    path.posix.normalize(parentUri.path.replace(/\\/g, "/"))
  );
  const childPath = foldDrive(
    path.posix.normalize(childUri.path.replace(/\\/g, "/"))
  );

  const parentBase = parentPath.endsWith("/")
    ? parentPath.slice(0, -1)
    : parentPath;

  if (childPath === parentBase) {
    return null;
  }
  const prefix = `${parentBase}/`;
  if (!childPath.startsWith(prefix)) {
    return null;
  }
  const relative = childPath.slice(prefix.length);
  // A normalized descendant cannot contain '..'; refuse to emit one if it does.
  if (relative.split("/").includes("..")) {
    return null;
  }
  return relative;
}

export function normalizeWindowsUri(uri: string) {
  if (os.platform() === "win32") {
    // Check if the URI is already correctly formatted
    const windowsFilePattern = /^file:\/\/\/[a-zA-Z]:\\/;
    if (windowsFilePattern.test(uri)) {
      return uri;
    }

    // If not, correct the URI to have the right number of slashes
    const malformedPattern = /^file:\/\/([a-zA-Z]):\//;
    const correctedUri = uri.replace(malformedPattern, "file:///$1:/");

    return correctedUri;
  } else {
    return uri;
  }
}

// Schemes accepted from terminal-link targets. Local files arrive as bare
// paths (the non-URI branch), so file:// is allowed only with an empty
// authority; the rest are the remote backends Inspect itself supports.
const kTerminalLinkSchemes = ["http", "https", "s3", "file"];

/**
 * Parse a scheme-qualified terminal-link target into a Uri, or null if it is
 * not a target we are willing to dereference. Terminal output is attacker-
 * influenceable, so this rejects unexpected schemes (vscode://, custom OS
 * handlers) and file:// URIs carrying a host — a `file://attacker/share`
 * dereference triggers an implicit SMB/WebDAV NTLM handshake on Windows.
 */
export function parseTerminalLinkUri(link: string): Uri | null {
  let uri: Uri;
  try {
    uri = Uri.parse(link);
  } catch {
    return null;
  }
  const scheme = uri.scheme.toLowerCase();
  if (!kTerminalLinkSchemes.includes(scheme)) {
    return null;
  }
  if (scheme === "file" && uri.authority) {
    return null;
  }
  return uri;
}

/**
 * Whether a path is UNC form (leading `\\` or `//`). Any filesystem operation
 * on a UNC path opens a connection to the named host, leaking NTLM credentials,
 * so terminal-supplied UNC paths must not be dereferenced.
 */
export function isUncPath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

export function isUri(str: string): boolean {
  // A single letter before the colon is a Windows drive letter (e.g. C:\),
  // not a URI scheme. URI schemes must be at least 2 characters long.
  const uriPattern = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
  return uriPattern.test(str);
}
