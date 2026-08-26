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
  const parentPath = path.posix.normalize(parentUri.path);
  const childPath = path.posix.normalize(childUri.path);

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
