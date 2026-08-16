import { lstat, realpath } from "fs/promises";
import * as os from "os";
import path from "path";

import { Uri } from "vscode";

export type ViewPathScopeKind = "directory" | "file";

export interface ViewPathScope {
  kind: ViewPathScopeKind;
  uri: Uri;
  canonicalUri: Promise<Uri>;
  opaqueLocation?: string;
  canonical?: boolean;
}

export function directoryViewPathScope(uri: Uri): ViewPathScope {
  return createViewPathScope("directory", uri);
}

export function fileViewPathScope(
  uri: Uri,
  opaqueLocation?: string,
  canonicalLocation?: string
): ViewPathScope {
  return createViewPathScope("file", uri, opaqueLocation, canonicalLocation);
}

export function viewPathScopesEqual(
  left: ViewPathScope,
  right: ViewPathScope
): boolean {
  return (
    left.kind === right.kind &&
    !!left.canonical === !!right.canonical &&
    (left.opaqueLocation ?? viewPathUriString(left.uri)) ===
      (right.opaqueLocation ?? viewPathUriString(right.uri))
  );
}

const kViewPathLocationFragment = "inspect-view-location=";
const kCanonicalViewPathLocationFragment = "inspect-view-canonical-location=";

export function withViewPathLocation(uri: Uri, location: string): Uri {
  return isOpaqueHttpViewLocation(location)
    ? uri.with({
        fragment:
          kViewPathLocationFragment +
          Buffer.from(location, "utf-8").toString("base64url"),
      })
    : uri;
}

export function viewPathLocationFromUri(uri: Uri): string | undefined {
  if (!uri.fragment.startsWith(kViewPathLocationFragment)) {
    return undefined;
  }
  try {
    return Buffer.from(
      uri.fragment.slice(kViewPathLocationFragment.length),
      "base64url"
    ).toString("utf-8");
  } catch {
    return undefined;
  }
}

export function withCanonicalViewPathLocation(uri: Uri, location: string): Uri {
  return uri.with({
    fragment:
      kCanonicalViewPathLocationFragment +
      Buffer.from(location, "utf-8").toString("base64url"),
  });
}

export function canonicalViewPathLocationFromUri(uri: Uri): string | undefined {
  if (!uri.fragment.startsWith(kCanonicalViewPathLocationFragment)) {
    return undefined;
  }
  try {
    return Buffer.from(
      uri.fragment.slice(kCanonicalViewPathLocationFragment.length),
      "base64url"
    ).toString("utf-8");
  } catch {
    return undefined;
  }
}

export function isOpaqueHttpViewLocation(location: string): boolean {
  try {
    const parsed = new URL(location);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.hash &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function viewPathUriString(uri: Uri): string {
  const base = uri.with({ query: "", fragment: "" }).toString();
  const query = canonicalRemoteQuery(uri.query);
  return query ? `${base}?${query}` : base;
}

export async function assertPathInViewScope(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<Uri> {
  const resolved = await resolvePathInViewScope(scope, candidate);
  if (!resolved) {
    const location =
      typeof candidate === "string" ? candidate : candidate.toString();
    throw new Error(
      `Viewer path is outside the selected ${scope.kind} scope: ${location}`
    );
  }
  return resolved;
}

export async function pathIsInViewScope(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<boolean> {
  return (await resolvePathInViewScope(scope, candidate)) !== null;
}

export async function resolvePathInViewScope(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<Uri | null> {
  if (scope.opaqueLocation) {
    if (
      candidate instanceof Uri &&
      candidate.toString() === scope.uri.toString()
    ) {
      return scope.uri;
    }
    const candidateLocation =
      typeof candidate === "string"
        ? candidate
        : (viewPathLocationFromUri(candidate) ?? viewPathUriString(candidate));
    return candidateLocation === scope.opaqueLocation ? scope.uri : null;
  }

  const candidateUri = resolveViewPathCandidate(scope, candidate);
  if (scope.uri.scheme === "file") {
    const [scopeUri, candidatePath] = await Promise.all([
      scope.canonicalUri,
      canonicalLocalPath(candidateUri),
    ]);
    if (!candidatePath) {
      return null;
    }
    const scopePath = scopeUri.fsPath;
    if (scope.kind === "file") {
      return localPathsEqual(candidatePath, scopePath)
        ? Uri.file(candidatePath)
        : null;
    }
    return localPathContains(scopePath, candidatePath)
      ? Uri.file(candidatePath)
      : null;
  }

  const scopeRemote = canonicalRemoteUri(await scope.canonicalUri);
  const candidateRemote = canonicalRemoteUri(candidateUri);
  if (!scopeRemote || !candidateRemote) {
    return null;
  }
  if (
    scopeRemote.scheme !== candidateRemote.scheme ||
    scopeRemote.authority !== candidateRemote.authority
  ) {
    return null;
  }
  if (
    scope.kind === "directory" &&
    (scopeRemote.scheme === "http" || scopeRemote.scheme === "https")
  ) {
    return null;
  }
  const resolved = candidateUri.with({
    scheme: candidateRemote.scheme,
    authority: candidateRemote.authority,
    path: candidateRemote.path,
    query: candidateUri.query,
    fragment: "",
  });
  if (scope.kind === "file") {
    // Signed URL queries are part of the exact-file capability.
    return candidateRemote.path === scopeRemote.path &&
      candidateRemote.query === scopeRemote.query
      ? resolved
      : null;
  }
  if (scopeRemote.query || candidateRemote.query) {
    return null;
  }
  return remotePathContains(scopeRemote.path, candidateRemote.path)
    ? resolved
    : null;
}

export async function viewPathScopeLocation(
  scope: ViewPathScope
): Promise<string> {
  return scope.opaqueLocation ?? viewPathUriString(await scope.canonicalUri);
}

export async function resolveViewPathLocation(
  scope: ViewPathScope,
  candidate: string | Uri
): Promise<string> {
  const resolved = await assertPathInViewScope(scope, candidate);
  return scope.opaqueLocation ?? viewPathUriString(resolved);
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

function createViewPathScope(
  kind: ViewPathScopeKind,
  uri: Uri,
  opaqueLocation?: string,
  canonicalLocation?: string
): ViewPathScope {
  if (kind === "file" && canonicalLocation) {
    if (viewPathUriString(uri) !== canonicalLocation) {
      throw new Error(
        `Canonical viewer file scope does not match: ${canonicalLocation}`
      );
    }
    return {
      kind,
      uri,
      canonicalUri: Promise.resolve(uri.with({ fragment: "" })),
      canonical: true,
    };
  }

  if (kind === "file" && opaqueLocation) {
    if (!isOpaqueHttpViewLocation(opaqueLocation)) {
      throw new Error(`Invalid viewer file scope: ${opaqueLocation}`);
    }
    const opaqueUri = Uri.parse(opaqueLocation);
    if (
      opaqueUri.scheme.toLowerCase() !== uri.scheme.toLowerCase() ||
      opaqueUri.authority.toLowerCase() !== uri.authority.toLowerCase() ||
      opaqueUri.path !== uri.path
    ) {
      throw new Error(`Viewer file scope does not match: ${opaqueLocation}`);
    }
    return {
      kind,
      uri,
      canonicalUri: Promise.resolve(uri.with({ fragment: "" })),
      opaqueLocation,
    };
  }

  if (uri.scheme === "file") {
    let canonicalUri: Promise<Uri> | undefined;
    return {
      kind,
      uri,
      get canonicalUri() {
        canonicalUri ??= canonicalLocalPath(uri).then((canonicalPath) => {
          if (!canonicalPath) {
            throw new Error(`Invalid viewer ${kind} scope: ${uri.toString()}`);
          }
          return Uri.file(canonicalPath);
        });
        return canonicalUri;
      },
    };
  }

  const remote = canonicalRemoteUri(uri);
  let canonicalUri = remote
    ? uri.with({
        scheme: remote.scheme,
        authority: remote.authority,
        path: remote.path,
        query: uri.query,
        fragment: "",
      })
    : null;
  if (
    kind === "directory" &&
    remote &&
    (remote.query || remote.scheme === "http" || remote.scheme === "https")
  ) {
    canonicalUri = null;
  }
  if (!canonicalUri) {
    throw new Error(`Invalid viewer ${kind} scope: ${uri.toString()}`);
  }
  return { kind, uri, canonicalUri: Promise.resolve(canonicalUri) };
}

async function canonicalLocalPath(uri: Uri): Promise<string | null> {
  if (
    uri.scheme !== "file" ||
    uri.query ||
    uri.fragment ||
    !isSupportedLocalFileAuthority(uri.authority)
  ) {
    return null;
  }
  return await realpathAllowMissing(uri.fsPath);
}

function isSupportedLocalFileAuthority(authority: string): boolean {
  if (!authority || authority.toLowerCase() === "localhost") {
    return true;
  }
  return (
    os.platform() === "win32" &&
    !authority.includes("@") &&
    !authority.includes(":")
  );
}

async function realpathAllowMissing(value: string): Promise<string | null> {
  let current = path.resolve(value);
  const missing: string[] = [];

  while (true) {
    try {
      return path.join(await realpath(current), ...missing);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        return null;
      }
    }

    try {
      if ((await lstat(current)).isSymbolicLink()) {
        return null;
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        return null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function normalizeLocalPath(value: string): string {
  const normalized = path.normalize(value);
  return os.platform() === "win32" ? normalized.toLowerCase() : normalized;
}

function localPathsEqual(left: string, right: string): boolean {
  return (
    normalizeLocalPath(path.resolve(left)) ===
    normalizeLocalPath(path.resolve(right))
  );
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
  query: string;
}

function canonicalRemoteUri(uri: Uri): CanonicalRemoteUri | null {
  if (
    !uri.scheme ||
    uri.scheme === "file" ||
    !uri.authority ||
    uri.authority.includes("@") ||
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
    query: canonicalRemoteQuery(uri.query),
  };
}

function canonicalRemoteQuery(query: string): string {
  if (!query) {
    return "";
  }

  const encode = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );

  return query
    .split("&")
    .map((field) => {
      const separator = field.indexOf("=");
      return separator === -1
        ? encode(field)
        : `${encode(field.slice(0, separator))}=${encode(
            field.slice(separator + 1)
          )}`;
    })
    .join("&");
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
