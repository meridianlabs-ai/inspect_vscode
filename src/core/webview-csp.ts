// Content-Security-Policy for viewer webviews, built from the policy file a
// viewer dist ships. Like ./webview-render, this must not import `vscode`.

import { readFileSync } from "fs";
import { join } from "path";

/** Name of the policy file in a viewer dist directory. */
export const kViewerCspFileName = "content-security-policy.json";

/** A validated `content-security-policy.json`. */
export interface ViewerCspFile {
  version: 1;
  /** Directive name to its sources, in the order the viewer lists them. */
  directives: Record<string, string[]>;
}

/** Outcome of reading a dist's policy file. */
export type ViewerCspLoad =
  | { status: "absent" }
  | { status: "valid"; policy: ViewerCspFile }
  | { status: "invalid"; path: string; reason: string };

/** A policy file that exists but can't be used. */
export class ViewerCspError extends Error {}

const kDirectiveName = /^[a-z][a-z0-9-]*$/;
// Printable ASCII with no whitespace. The characters rejected below would end
// a directive or the policy, or break out of the meta tag's content attribute.
const kSourceChars = /^[\x21-\x7e]+$/;
const kForbiddenSourceChars = /[;,"<>&\\`]/;
const kQuotedSource = /^'[^']+'$/;
const kNonce = /^[A-Za-z0-9+/_=-]+$/;

// The translation augments script-src and worker-src, and a policy without
// default-src would leave everything it doesn't list unrestricted.
const kNonceDirectives = ["script-src", "script-src-elem"];

const kRequiredDirectives = ["default-src", "script-src", "worker-src"];

/**
 * Read `<viewDir>/content-security-policy.json`. A missing file means the dist
 * predates the policy file; anything else that can't be read or validated is
 * `invalid` rather than a silent fallback to the legacy policy.
 */
export function loadViewerCsp(viewDir: string): ViewerCspLoad {
  const path = join(viewDir, kViewerCspFileName);
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { status: "absent" };
    }
    return {
      status: "invalid",
      path,
      reason: `could not be read (${errorMessage(error)})`,
    };
  }
  try {
    return { status: "valid", policy: parseViewerCsp(text) };
  } catch (error) {
    if (error instanceof ViewerCspError) {
      return { status: "invalid", path, reason: error.message };
    }
    throw error;
  }
}

/**
 * Parse and validate the text of a policy file.
 *
 * @throws ViewerCspError if the text is not a valid version 1 policy.
 */
export function parseViewerCsp(text: string): ViewerCspFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ViewerCspError(`not valid JSON (${errorMessage(error)})`);
  }
  return validateViewerCsp(raw);
}

/**
 * Translate a viewer's policy for a VS Code webview, where the document origin
 * (`vscode-webview://`) is not where assets are served from:
 *
 * - every directive that lists `'self'` also gets `cspSource`;
 * - `script-src` (and `script-src-elem`, if the viewer splits it out) gets
 *   `'nonce-<nonce>'`, which the extension stamps on every `<script>` in the
 *   viewer's index.html;
 * - `worker-src` gets `blob:`, for the viewer's fallback of starting a
 *   cross-origin worker script from a Blob URL.
 *
 * Every other directive and source is kept as the viewer ships it.
 *
 * @param cspSource `webview.cspSource`; may hold several space-separated sources.
 * @throws ViewerCspError if `policy` is not a valid policy.
 */
export function buildWebviewCsp(
  policy: ViewerCspFile,
  cspSource: string,
  nonce: string
): string {
  const { directives } = validateViewerCsp(policy);
  const hostSources = cspSource.split(/\s+/).filter((s) => s.length > 0);
  if (hostSources.length === 0 || !hostSources.every(isValidSource)) {
    throw new Error(`Invalid webview cspSource: ${JSON.stringify(cspSource)}`);
  }
  if (!kNonce.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }

  return Object.entries(directives)
    .map(([name, sources]) => {
      const out: string[] = [];
      const add = (source: string) => {
        if (!out.includes(source)) {
          out.push(source);
        }
      };
      for (const source of sources) {
        out.push(source);
        if (source.toLowerCase() === "'self'") {
          hostSources.filter((s) => !sources.includes(s)).forEach(add);
        }
      }
      if (kNonceDirectives.includes(name)) {
        add(`'nonce-${nonce}'`);
      } else if (name === "worker-src") {
        add("blob:");
      }
      return [name, ...out].join(" ");
    })
    .join("; ");
}

/**
 * Remove any `<meta http-equiv="Content-Security-Policy">` from a viewer's
 * index.html. Every policy on a page is enforced, and a viewer's own `'self'`
 * would block every webview asset.
 */
export function stripCspMeta(html: string): string {
  return html.replace(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*(["']?)content-security-policy\1(?=[\s/>])[^>]*>/gi,
    ""
  );
}

function validateViewerCsp(raw: unknown): ViewerCspFile {
  if (!isRecord(raw)) {
    throw new ViewerCspError("expected a JSON object");
  }
  if (raw.version !== 1) {
    throw new ViewerCspError(
      `unsupported version ${JSON.stringify(raw.version)} (expected 1)`
    );
  }
  if (!isRecord(raw.directives)) {
    throw new ViewerCspError("`directives` must be an object");
  }

  // Directive names must start with a letter, so Object.entries keeps the
  // file's order (integer-like keys would be reordered).
  const directives: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw.directives)) {
    if (!kDirectiveName.test(name)) {
      throw new ViewerCspError(
        `invalid directive name ${JSON.stringify(name)}`
      );
    }
    if (!Array.isArray(value)) {
      throw new ViewerCspError(`\`${name}\` must be an array of sources`);
    }
    const items: unknown[] = value;
    const sources: string[] = [];
    for (const source of items) {
      if (typeof source !== "string" || !isValidSource(source)) {
        throw new ViewerCspError(
          `invalid source ${JSON.stringify(source)} in \`${name}\``
        );
      }
      sources.push(source);
    }
    directives[name] = sources;
  }

  for (const name of kRequiredDirectives) {
    if (!(name in directives)) {
      throw new ViewerCspError(`missing required directive \`${name}\``);
    }
  }
  return { version: 1, directives };
}

function isValidSource(source: string): boolean {
  if (!kSourceChars.test(source) || kForbiddenSourceChars.test(source)) {
    return false;
  }
  // Quotes only as a keyword/hash/nonce wrapper: 'self', 'sha256-…'.
  return !source.includes("'") || kQuotedSource.test(source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
