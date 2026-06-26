import { realpath } from "fs/promises";
import * as os from "os";
import path from "path";

import { Uri } from "vscode";

export type ViewPathScopeKind = "directory" | "file";

export interface ViewPathScope {
  kind: ViewPathScopeKind;
  uri: Uri;
}

export function directoryViewPathScope(uri: Uri): ViewPathScope {
  return { kind: "directory", uri };
}

export function fileViewPathScope(uri: Uri): ViewPathScope {
  return { kind: "file", uri };
}

export async function assertPathInViewScope(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<void> {
  if (!(await pathIsInViewScope(scope, candidate))) {
    const location =
      typeof candidate === "string" ? candidate : candidate.toString();
    throw new Error(
      `Viewer path is outside the selected ${scope.kind} scope: ${location}`
    );
  }
}

export async function pathIsInViewScope(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<boolean> {
  const candidateUri = resolveViewPathCandidate(scope, candidate);
  if (scope.uri.scheme === "file") {
    if (candidateUri.scheme !== "file") {
      return false;
    }
    try {
      const [scopePath, candidatePath] = await Promise.all([
        realpath(scope.uri.fsPath),
        realpath(candidateUri.fsPath),
      ]);
      if (scope.kind === "file") {
        return (
          normalizeLocalPath(candidatePath) === normalizeLocalPath(scopePath)
        );
      }
      return localPathContains(scopePath, candidatePath);
    } catch {
      return false;
    }
  }

  const scopeRemote = canonicalRemoteUri(scope.uri);
  const candidateRemote = canonicalRemoteUri(candidateUri);
  if (!scopeRemote || !candidateRemote) {
    return false;
  }
  if (
    scopeRemote.scheme !== candidateRemote.scheme ||
    scopeRemote.authority !== candidateRemote.authority
  ) {
    return false;
  }
  if (
    scope.kind === "directory" &&
    (scopeRemote.scheme === "http" || scopeRemote.scheme === "https")
  ) {
    return false;
  }
  if (scope.kind === "file") {
    return candidateRemote.path === scopeRemote.path;
  }
  return remotePathContains(scopeRemote.path, candidateRemote.path);
}

export function resolveViewPathCandidate(
  scope: ViewPathScope,
  candidate: string | Uri
): Uri {
  if (candidate instanceof Uri) {
    return candidate;
  }
  if (isUri(candidate) || path.isAbsolute(candidate)) {
    return resolveToUri(candidate);
  }
  return scope.uri.scheme === "file"
    ? Uri.file(path.resolve(scope.uri.fsPath, candidate))
    : Uri.joinPath(scope.uri, candidate);
}

function normalizeLocalPath(value: string): string {
  const normalized = path.normalize(value);
  return os.platform() === "win32" ? normalized.toLowerCase() : normalized;
}

function localPathContains(parent: string, child: string): boolean {
  const relative = path.relative(
    normalizeLocalPath(parent),
    normalizeLocalPath(child)
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

interface CanonicalRemoteUri {
  scheme: string;
  authority: string;
  path: string;
}

function canonicalRemoteUri(uri: Uri): CanonicalRemoteUri | null {
  if (
    !uri.scheme ||
    uri.scheme === "file" ||
    !uri.authority ||
    uri.query ||
    uri.fragment
  ) {
    return null;
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(uri.path);
  } catch {
    return null;
  }
  if (decodedPath.includes("\\") || decodedPath.split("/").includes("..")) {
    return null;
  }
  return {
    scheme: uri.scheme.toLowerCase(),
    authority: uri.authority.toLowerCase(),
    path: path.posix.normalize(`/${decodedPath.replace(/^\/+/, "")}`),
  };
}

function remotePathContains(parent: string, child: string): boolean {
  const relative = path.posix.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.posix.isAbsolute(relative))
  );
}

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
 * Gets the relative path from a parent Uri to a child Uri
 * Returns null if child is not contained within parent
 */
export function getRelativeUri(parentUri: Uri, childUri: Uri): string | null {
  if (
    parentUri.scheme.toLowerCase() !== childUri.scheme.toLowerCase() ||
    parentUri.authority.toLowerCase() !== childUri.authority.toLowerCase()
  ) {
    return null;
  }

  if (
    parentUri.query ||
    parentUri.fragment ||
    childUri.query ||
    childUri.fragment
  ) {
    return null;
  }

  const relative =
    parentUri.scheme === "file"
      ? path.relative(parentUri.fsPath, childUri.fsPath)
      : path.posix.relative(
          path.posix.normalize(parentUri.path),
          path.posix.normalize(childUri.path)
        );
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    path.posix.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.replaceAll(path.sep, "/");
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

export function isUri(str: string): boolean {
  // A single letter before the colon is a Windows drive letter (e.g. C:\),
  // not a URI scheme. URI schemes must be at least 2 characters long.
  const uriPattern = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
  return uriPattern.test(str);
}
