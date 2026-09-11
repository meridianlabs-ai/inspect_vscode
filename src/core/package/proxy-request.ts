/* eslint-disable no-control-regex -- Reject control characters at the RPC boundary. */
import { validateHeaderValue } from "http";

import type { HttpProxyRpcRequest } from "./view-server";

/** Validate untrusted RPC data before starting or touching a shared server. */
export function parseProxyRequest(value: unknown): HttpProxyRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid proxy request");
  }
  const { method, path, headers, body } = value as Record<string, unknown>;
  if (
    typeof method !== "string" ||
    !["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method) ||
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    /[\\#\s\u0000-\u001f\u007f]/u.test(path) ||
    (body !== undefined &&
      (typeof body !== "string" || method === "GET" || method === "HEAD")) ||
    (headers !== undefined &&
      (!headers || typeof headers !== "object" || Array.isArray(headers)))
  ) {
    throw new Error("Invalid proxy request");
  }
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      if (
        typeof value !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        /[\r\n\u0000]/u.test(value) ||
        /^(authorization|host|connection|keep-alive|content-length|transfer-encoding|upgrade|expect|trailer)$/i.test(
          name
        )
      ) {
        throw new Error("Invalid proxy headers");
      }
      // Headers/Request accept some control bytes that the HTTP dispatcher
      // rejects later. Reject those before they can reach the lifecycle catch.
      validateHeaderValue(name, value);
    }
  }
  // Request construction checks byte-valued headers and Fetch's body rules
  // locally, outside the transport-error handler and before ensureRunning.
  new Request(`http://127.0.0.1${path}`, {
    method,
    headers: headers as Record<string, string> | undefined,
    body: body,
  });
  return value as HttpProxyRpcRequest;
}
