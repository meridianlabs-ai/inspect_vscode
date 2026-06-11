import { existsSync } from "fs";

import { commands, ExtensionContext, Uri, UriHandler, window } from "vscode";

import { showError } from "../components/error";

// Schemes we are willing to open a log from. Anyone can invoke this URI
// handler, so we restrict it to local files and the remote backends Inspect
// itself supports rather than forwarding arbitrary URIs to the view server.
const kAllowedLogSchemes = ["file", "https", "http", "s3"];

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
  const lowerPath = uri.path.toLowerCase();
  if (!kAllowedLogExtensions.some((ext) => lowerPath.endsWith(ext))) {
    return `Unable to open log: "${uri.path}" is not an Inspect log file.`;
  }
  return null;
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
          }

          // Execute the open command
          await commands.executeCommand("inspect.openLogViewer", logUri);
        }
      }
    }
  }
}
