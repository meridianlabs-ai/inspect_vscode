import { existsSync } from "fs";

import {
  commands,
  ExtensionContext,
  MessageItem,
  Uri,
  UriHandler,
  window,
} from "vscode";

import { showError } from "../components/error";
import { isUncPath } from "../core/uri";

// Schemes we are willing to open a log from. Anyone can invoke this URI
// handler, so we restrict it to local files and the remote backends Inspect
// itself supports rather than forwarding arbitrary URIs to the view server.
const kAllowedLogSchemes = ["file", "https", "http", "s3"];

// A remote authority must look like a plain host[:port] (optionally an IPv6
// literal in brackets). Uri.parse percent-decodes the authority, so this also
// rejects userinfo (`spoof@host`) and any decoded whitespace/control/bidi
// characters that could spoof the confirmation dialog. Underscores are allowed
// (docker-compose service names, some internal DNS) — they carry no spoofing
// power. See CWE-451.
const kValidAuthorityPattern = /^[A-Za-z0-9._~:[\]_-]+$/;

// Recognized Inspect log file extensions.
const kAllowedLogExtensions = [".eval", ".json"];

export function activateProtocolHandler(context: ExtensionContext) {
  const protocolHandler = new InspectProtocolHandler();
  context.subscriptions.push(window.registerUriHandler(protocolHandler));
}

/**
 * Validates a log URI received from the (externally-invokable) URI handler.
 *
 * Anyone can navigate a browser to `vscode://ukaisi.inspect-ai/open?log=<uri>`,
 * so we only forward URIs that look like an Inspect log on a backend we
 * support, rather than passing arbitrary URIs to the view server. Returns an
 * error message describing why the URI was rejected, or `null` if it is
 * acceptable. Pure (no file-system access) so it can be unit tested.
 */
export function validateLogUri(uri: Uri): string | null {
  if (!kAllowedLogSchemes.includes(uri.scheme)) {
    return `Unable to open log: unsupported location "${uri.scheme}:".`;
  }
  // A file URI with an authority (or a UNC-form path) designates a remote host;
  // dereferencing it — even existsSync — triggers an implicit SMB/WebDAV NTLM
  // handshake on Windows that leaks the user's credentials. Reject it before any
  // filesystem touch, matching parseTerminalLinkUri / isAcceptableSignalUri.
  // See CWE-522.
  if (uri.scheme === "file" && (uri.authority || isUncPath(uri.fsPath))) {
    return `Unable to open log: file URLs with a host are not supported.`;
  }
  // For remote schemes, require a clean host[:port] authority so the fetch
  // target is unambiguous and the confirmation dialog can't be spoofed.
  if (
    uri.scheme !== "file" &&
    uri.authority &&
    !kValidAuthorityPattern.test(uri.authority)
  ) {
    return `Unable to open log: the log URL has an invalid host.`;
  }
  const lowerPath = uri.path.toLowerCase();
  if (!kAllowedLogExtensions.some((ext) => lowerPath.endsWith(ext))) {
    return `Unable to open log: "${uri.path}" is not an Inspect log file.`;
  }

  // The sample_id/epoch query parameters flow into the log-view webview HTML,
  // so reject markup-significant characters here at the (externally-invokable)
  // entry point rather than relying solely on downstream escaping. `epoch` is
  // always a non-negative integer; `sample_id` is an arbitrary identifier but
  // never legitimately contains HTML markup.
  if (uri.query) {
    const params = new URLSearchParams(uri.query);
    const epoch = params.get("epoch");
    if (epoch !== null && !/^\d+$/.test(epoch)) {
      return `Unable to open log: invalid epoch "${epoch}".`;
    }
    const sampleId = params.get("sample_id");
    if (sampleId !== null && /[<>&"'`\u2028\u2029]/.test(sampleId)) {
      return `Unable to open log: invalid sample id.`;
    }
  }
  return null;
}

/**
 * Confirm opening a remote log/scan, naming the host/bucket so the user can see
 * who they are fetching from. `source` describes what triggered the open (a
 * drive-by website, a terminal link, …) and `noun` what is being opened
 * ("Inspect log", "scan results") so the prompt matches its caller. Returns true
 * only if the user explicitly chooses to open it.
 */
export async function confirmRemoteOpen(
  logUri: Uri,
  opts?: { source?: string; noun?: string }
): Promise<boolean> {
  const source = opts?.source ?? "A website";
  const noun = opts?.noun ?? "an Inspect log";
  // Display only the real host: drop any userinfo (everything before the final
  // '@') and refuse to render decoded control/whitespace, so the named location
  // can't be spoofed even if a caller reaches here without validateLogUri.
  const authorityHost = (logUri.authority || "").split("@").pop() ?? "";
  const location =
    authorityHost && kValidAuthorityPattern.test(authorityHost)
      ? authorityHost
      : logUri.authority
        ? "an unrecognized host"
        : logUri.toString(true);
  const open: MessageItem = { title: "Open" };
  const cancel: MessageItem = { title: "Cancel", isCloseAffordance: true };
  const choice = await window.showWarningMessage(
    `${source} asked VS Code to open ${noun} from "${location}". ` +
      `Opening it will fetch content from that location. Open it?`,
    { modal: true },
    open,
    cancel
  );
  return choice === open;
}

export class InspectProtocolHandler implements UriHandler {
  public async handleUri(uri: Uri): Promise<void> {
    // Read the command
    const command = uri.path.replace(/^\//, "");
    const queryParams = new URLSearchParams(uri.query);
    switch (command) {
      // The open command
      case "open": {
        // Get the log file
        const logFile = queryParams.get("log");
        if (logFile) {
          const logUri = Uri.parse(logFile);

          // This handler can be invoked by any web page (anyone can navigate to
          // vscode://ukaisi.inspect-ai/open?log=<uri>), so validate the target
          // before forwarding it to the log viewer.
          const validationError = validateLogUri(logUri);
          if (validationError) {
            await showError(validationError);
            return;
          }

          // For local file paths, make sure the file exists or show an error
          if (logUri.scheme === "file") {
            if (!existsSync(logUri.fsPath)) {
              await showError(`The file ${logUri.fsPath} does not exist.`);
              return;
            }
          } else {
            // Remote schemes (http/https/s3): the drive-by caller — not the
            // user — chose this host/bucket, and opening it makes the local
            // view server fetch it with the victim's ambient credentials. Since
            // validateLogUri deliberately allows any authority, require explicit
            // confirmation naming the host before any fetch/render.
            const confirmed = await confirmRemoteOpen(logUri);
            if (!confirmed) {
              return;
            }
          }

          // Execute the open command
          await commands.executeCommand("inspect.openLogViewer", logUri);
        }
      }
    }
  }
}
