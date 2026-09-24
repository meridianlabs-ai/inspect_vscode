// Builds the viewer webview's HTML from a dist's index.html. This module must
// not import `vscode`: tests and external harnesses render the page with it
// outside VS Code, and `getWebviewPanelHtml` (./webview) is the thin wrapper
// that supplies the VS Code pieces.

import {
  buildWebviewCsp,
  kViewerCspFileName,
  stripCspMeta,
  ViewerCspLoad,
} from "./webview-csp";

export interface RenderWebviewHtmlOptions {
  /** Text of the viewer dist's `index.html`. */
  indexHtml: string;
  /**
   * The dist's policy file (`loadViewerCsp`). A valid file replaces the legacy
   * policy; an invalid one renders an error page instead of the viewer.
   */
  policy: ViewerCspLoad;
  /** Source expression(s) that assets are served from (`webview.cspSource`). */
  cspSource: string;
  /** Nonce stamped on every `<script>` in `indexHtml` and listed in the policy. */
  nonce: string;
  /** Maps an asset path referenced by `indexHtml` to the URL it is served at. */
  resourceUri: (path: string) => string;
  /** Written to the `inspect-extension:version` meta tag. */
  extensionVersion: string;
  /** Stylesheet URL injected only for the old unbundled viewer. */
  unbundledCssOverride?: string | null;
  /**
   * Untrusted head fragment (e.g. JSON state blocks). Inserted after nonces are
   * stamped, so any script in it stays blocked.
   */
  extraHead?: string;
  /** Package name used in user-facing messages. */
  packageName?: string;
}

/**
 * Serialize a value to JSON for embedding inside an inline `<script>` element.
 *
 * `JSON.stringify` does not escape HTML-significant characters, so a string
 * value containing `</script>` (e.g. an attacker-controlled field persisted via
 * the webview's setState) would otherwise terminate the script element and
 * inject live markup into the webview. Escaping `<`, `>`, `&` — plus the
 * U+2028/U+2029 line separators that are invalid in JS string literals — keeps
 * the serialized payload inert as HTML regardless of its contents.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

/**
 * The hand-written policy for viewers that predate the viewer-shipped policy
 * file. Those viewers need `'unsafe-eval'`, Blob workers and inline styles.
 */
export function legacyWebviewCsp(cspSource: string, nonce: string): string {
  return `default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; worker-src 'self' ${cspSource} blob:; script-src 'nonce-${nonce}' 'unsafe-eval'; script-src-elem 'nonce-${nonce}' ${cspSource}; connect-src ${cspSource} blob:;`;
}

/**
 * Render the webview page for a viewer dist's `index.html`: tags the html
 * element, replaces any CSP meta with the webview's policy, injects the version
 * meta, stamps script nonces, inserts `extraHead` and rewrites asset references
 * through `resourceUri`.
 */
export function renderWebviewHtml(options: RenderWebviewHtmlOptions): string {
  const {
    policy,
    cspSource,
    nonce,
    resourceUri,
    extensionVersion,
    unbundledCssOverride = null,
    extraHead = "",
    packageName = "the package",
  } = options;
  let indexHtml = options.indexHtml;

  // If the index.html doesn't contain HTML looking text, then it is likely
  // a git lfs pointer file. This can happen if the user is running 0.4.22, which
  // will not have the 'dist' server endpoint but may have lfs files where the
  // view assets are stored. In this case, show a message about updating the version.
  const isHtml = indexHtml.includes("<html");
  if (!isHtml) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
</head>
<body>
Please update to a newer version of ${packageName} to view this content.
</body>
</html>`;
  }

  // The CSP meta is inserted after this exact tag.
  const headTag = "<head>\n";

  let csp: string;
  switch (policy.status) {
    case "absent":
      csp = legacyWebviewCsp(cspSource, nonce);
      break;
    case "valid":
      // Fail closed: without the insertion point the page would carry no
      // policy at all once the viewer's own CSP meta is stripped.
      if (!indexHtml.includes(headTag)) {
        return getMessagePanelHtml(
          `${packageName} view could not be loaded because its index.html has no <head> element to carry the Content-Security-Policy.`
        );
      }
      csp = buildWebviewCsp(policy.policy, cspSource, nonce);
      break;
    case "invalid":
      return getMessagePanelHtml(invalidCspMessage(packageName, policy));
  }

  // Determine whether this is the old unbundled version of the html or the new
  // bundled version
  const isUnbundled = indexHtml.match(/"\.(\/App\.mjs)"/g);

  const overrideCssHtml =
    isUnbundled && unbundledCssOverride
      ? `<link rel="stylesheet" type ="text/css" href="${unbundledCssOverride}" >`
      : "";

  // decorate the html tag
  indexHtml = indexHtml.replace("<html ", '<html class="vscode" ');

  // add content security policy
  indexHtml = stripCspMeta(indexHtml);
  indexHtml = indexHtml.replace(
    headTag,
    `<head>
          <meta name="inspect-extension:version" content="${extensionVersion}">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    ${overrideCssHtml}
    <!--inspect-extra-head-->

    `
  );

  // nonces for scripts. Match the `<script` start tag followed by a tag
  // boundary (whitespace or `>`) so we don't accidentally match tags like
  // `<scripting>`. Case-insensitive and covers all whitespace forms.
  //
  // IMPORTANT: stamp nonces BEFORE inserting the caller-supplied `extraHead`
  // fragment. Otherwise any `<script>` element injected into `extraHead`
  // (e.g. by a value that broke out of an inline JSON payload) would receive
  // a valid CSP nonce and execute. Only scripts from the trusted index.html
  // template should be granted the nonce.
  indexHtml = indexHtml.replace(
    /<script(?=[\s>])/gi,
    (match) => `${match} nonce="${nonce}"`
  );

  // insert the (untrusted) extra head fragment only after nonces have been
  // stamped, so its scripts are not nonced and remain blocked by the CSP.
  indexHtml = indexHtml.replace("<!--inspect-extra-head-->", () => extraHead);

  // Determine whether this is the old index.html format (before bundling),
  // or the newer one. Fix up the html properly in each case

  if (isUnbundled) {
    // Old unbundle html
    // fixup css references
    indexHtml = indexHtml.replace(/href="\.([^"]+)"/g, (_, p1: string) => {
      return `href="${resourceUri(p1)}"`;
    });

    // fixup js references
    indexHtml = indexHtml.replace(/src="\.([^"]+)"/g, (_, p1: string) => {
      return `src="${resourceUri(p1)}"`;
    });

    // fixup import maps
    indexHtml = indexHtml.replace(
      /": "\.([^?"]+)(["?])/g,
      (_, p1: string, p2: string) => {
        return `": "${resourceUri(p1)}${p2}`;
      }
    );

    // fixup App.mjs
    indexHtml = indexHtml.replace(/"\.(\/App\.mjs)"/g, (_, p1: string) => {
      return `"${resourceUri(p1)}"`;
    });
  } else {
    // New bundled html
    // fixup css references
    indexHtml = indexHtml.replace(/href="([^"]+)"/g, (_, p1: string) => {
      return `href="${resourceUri(p1)}"`;
    });

    // fixup js references
    indexHtml = indexHtml.replace(/src="([^"]+)"/g, (_, p1: string) => {
      return `src="${resourceUri(p1)}"`;
    });
  }

  return indexHtml;
}

function invalidCspMessage(
  packageName: string,
  policy: Extract<ViewerCspLoad, { status: "invalid" }>
): string {
  return `${packageName} view could not be loaded because its ${kViewerCspFileName} is invalid: ${policy.reason}.\n\nFile: ${policy.path}\n\nReinstall or upgrade ${packageName} in the active Python interpreter, then try again.`;
}

/**
 * Minimal static HTML for showing an informational message in a webview
 * panel (e.g. when the view can't be rendered). The message is escaped and
 * rendered as plain text; blank lines separate paragraphs.
 */
export function getMessagePanelHtml(message: string): string {
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const paragraphs = message
    .split("\n\n")
    .map((para) => `<p>${escapeHtml(para)}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 0.5em 1em;
      }
    </style>
</head>
<body>
${paragraphs}
</body>
</html>`;
}
