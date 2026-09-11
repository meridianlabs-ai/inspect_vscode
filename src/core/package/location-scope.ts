/* eslint-disable no-control-regex -- Reject control characters at the RPC boundary. */
import path from "path";

import { Uri } from "vscode";

import { getRelativeUri } from "../uri";

/** Parse a consumer's decoded location without decoding or dropping path data.
 * Python's filesystem consumers keep literal ?, # and % in local/S3 paths.
 * Uri.parse would both split delimiters and perform an additional decode.
 */
export function locationUri(location: string, base?: Uri): Uri {
  if (!location || /[\u0000-\u001f\u007f]/u.test(location)) {
    throw new Error("Invalid location");
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]+):\/\/([^/]*)(.*)$/s.exec(location);
  if (match) {
    const scheme = match[1]!;
    const authority = match[2]!;
    const pathname = match[3]!;
    if (scheme === "file") {
      // file://C:/path is also accepted by Inspect's normalize_uri.
      if (/^[a-zA-Z]:$/.test(authority)) {
        return Uri.from({ scheme, path: `/${authority}${pathname}` });
      }
      if (authority) throw new Error("Unsupported file authority");
    }
    return Uri.from({ scheme, authority, path: pathname || "/" });
  }
  if (/^[a-zA-Z]:[\\/]/.test(location)) {
    return Uri.from({
      scheme: "file",
      path: "/" + location.replace(/\\/g, "/"),
    });
  }
  if (location.startsWith("/")) return Uri.file(location);
  // Local fsspec consumers expand home-relative forms before opening them.
  // Use an authorized absolute path, or ./ for a literal tilde name.
  if (location.startsWith("~"))
    throw new Error("Unsupported home-relative path");
  // A leading backslash is drive-rooted or UNC on Windows, never relative to
  // the project. These ambiguous forms require an explicit supported URI/path.
  if (location.startsWith("\\")) throw new Error("Unsupported rooted path");
  if (!base || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(location)) {
    throw new Error("Relative location without an authorized base");
  }
  return base.with({
    path:
      base.scheme === "file"
        ? path.posix.join(
            base.path,
            process.platform === "win32"
              ? location.replace(/\\/g, "/")
              : location
          )
        : `${base.path.replace(/\/$/, "")}/${location}`,
  });
}

export function locationInScope(
  roots: readonly Uri[],
  location: string,
  options: { decode?: boolean; exact?: boolean; base?: Uri } = {}
): boolean {
  try {
    const decoded = options.decode ? decodeURIComponent(location) : location;
    const target = locationUri(decoded, options.base);
    return roots.some((root) => {
      if (root.toString() === target.toString()) return true;
      if (options.exact || getRelativeUri(root, target) === null) return false;
      // POSIX filesystems keep backslashes in names. The shared URI helper
      // also accepts Windows separators, so check the POSIX interpretation
      // independently before authorizing a local consumer.
      if (root.scheme === "file" && process.platform !== "win32") {
        const relative = path.posix.relative(root.path, target.path);
        return (
          relative !== ".." &&
          !relative.startsWith("../") &&
          !path.posix.isAbsolute(relative)
        );
      }
      // Object stores preserve dot segments, repeated slashes and backslashes
      // in keys. Require their literal prefix too, before accepting the shared
      // helper's filesystem/URL-normalized interpretation. Neither reading may
      // broaden authority when a scheme has multiple supported consumers.
      return (
        root.scheme === "file" ||
        target.path.startsWith(`${root.path.replace(/\/$/, "")}/`)
      );
    });
  } catch {
    return false;
  }
}
