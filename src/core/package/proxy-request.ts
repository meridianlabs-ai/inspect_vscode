/* eslint-disable no-control-regex -- control characters are what these patterns reject */
import { validateHeaderValue } from "http";

import type { HttpProxyRpcRequest } from "./view-server";

/**
 * Validate an `http_request` payload from a webview before anything else
 * looks at it.
 *
 * The payload is untrusted (see SECURITY.md), and two properties of `fetch`
 * make loose handling dangerous. First, `fetch` normalizes the case of the
 * standard methods, so a method string that is not literally `"DELETE"` still
 * deletes on the wire: a policy that compares against `"DELETE"` is bypassed
 * by `"delete"`. Second, `fetch` rejects structurally invalid input (a body on
 * GET, a bad method token, a control byte in a header, a path that cannot
 * parse against the server port), and the view server treats a rejected fetch
 * as a dead server, which stops the shared child and aborts every panel's
 * in-flight request.
 *
 * Methods are therefore matched exactly against the upper-case tokens the
 * viewers use (no canonicalization), and every structural rule that `fetch`
 * or undici would enforce later is enforced here, synchronously, so a bad
 * request fails alone and before any server contact.
 */
export function parseProxyRequest(value: unknown): HttpProxyRpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("request");
  }
  const { method, path, headers } = value as Record<string, unknown>;
  // A fetch-style init defaults its body to null, and null (unlike undefined)
  // survives postMessage serialization; treat it as "no body".
  const body = (value as Record<string, unknown>).body ?? undefined;

  if (typeof method !== "string" || !kMethods.has(method)) {
    throw invalid("method");
  }
  // The view servers only serve absolute /api/ routes. Reject anything the URL
  // parser or the server would reinterpret: a relative path, a fragment, a
  // backslash, whitespace or a control byte.
  if (
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    /[\\#\s\u0000-\u001f\u007f]/.test(path)
  ) {
    throw invalid("path");
  }
  if (
    body !== undefined &&
    (typeof body !== "string" || method === "GET" || method === "HEAD")
  ) {
    throw invalid("body");
  }

  let parsedHeaders: Record<string, string> | undefined;
  if (headers !== undefined) {
    if (
      typeof headers !== "object" ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw invalid("headers");
    }
    parsedHeaders = {};
    for (const [name, headerValue] of Object.entries(headers)) {
      if (
        typeof headerValue !== "string" ||
        !kHeaderName.test(name) ||
        kReservedHeaders.test(name)
      ) {
        throw invalid("headers");
      }
      // `Headers` accepts some control bytes that the HTTP dispatcher refuses
      // when the request is sent; apply Node's wire rule now instead.
      try {
        validateHeaderValue(name, headerValue);
      } catch {
        throw invalid("headers");
      }
      parsedHeaders[name] = headerValue;
    }
  }

  // Finally, let the Fetch API apply its own construction rules locally.
  try {
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: parsedHeaders,
      body,
    });
  } catch {
    throw invalid("request");
  }

  return {
    method: method as HttpProxyRpcRequest["method"],
    path,
    ...(parsedHeaders !== undefined ? { headers: parsedHeaders } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

// Exact tokens only: `fetch` would accept and upper-case other spellings.
const kMethods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE"]);

// RFC 9110 token, the only shape a header field name may take.
const kHeaderName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Headers the extension host sets itself, that describe the connection rather
// than the request, or that undici refuses to send.
const kReservedHeaders =
  /^(authorization|host|connection|keep-alive|content-length|transfer-encoding|upgrade|expect|te|trailer)$/i;

function invalid(part: string): Error {
  return new Error(`Invalid proxied ${part}`);
}
