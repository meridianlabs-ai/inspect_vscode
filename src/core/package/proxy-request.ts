import type { HttpProxyRpcRequest } from "./view-server";

/**
 * Check that an `http_request` payload from a webview has the shape the proxy
 * contract promises before any policy check reads it.
 *
 * The payload is untrusted (see SECURITY.md). This is deliberately only the
 * proxy's own contract and authority, not a prediction of what `fetch` will
 * accept: the method must be one of the exact upper-case tokens the route
 * policy compares against (`fetch` would silently upper-case `"delete"` and
 * bypass a `"DELETE"` refusal), the path must be absolute so it can only ever
 * be appended to the extension-chosen loopback origin, and the webview may not
 * supply the headers the extension host owns. Anything else that `fetch` or
 * undici refuses (an invalid header value, a body on GET, ...) fails that one
 * request with a normal JSON-RPC error when it is sent.
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
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw invalid("path");
  }
  if (body !== undefined && typeof body !== "string") {
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
      if (typeof headerValue !== "string" || kReservedHeaders.test(name)) {
        throw invalid("headers");
      }
      parsedHeaders[name] = headerValue;
    }
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

// The extension host attaches the server token and chooses the server address.
const kReservedHeaders = /^(authorization|host)$/i;

function invalid(part: string): Error {
  return new Error(`Invalid proxied ${part}`);
}
