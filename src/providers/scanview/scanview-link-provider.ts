import { existsSync } from "fs";

import {
  commands,
  ExtensionContext,
  MessageItem,
  TerminalLink,
  TerminalLinkContext,
  Uri,
  window,
  workspace,
} from "vscode";

import { workspacePath } from "../../core/path";
import { isUncPath, parseTerminalLinkUri } from "../../core/uri";
import { confirmRemoteOpen } from "../protocol-handler";

const kScanResultPattern =
  /([^\s"]*scan_id=[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22})/g;

interface ScanViewTerminalLink extends TerminalLink {
  data: string;
}

export const scanviewTerminalLinkProvider = (_context: ExtensionContext) => {
  return {
    provideTerminalLinks: (context: TerminalLinkContext) => {
      const matches = [...context.line.matchAll(kScanResultPattern)];
      if (matches.length > 0) {
        // Forward matches
        const result = matches
          .map((match) => {
            // The path from the terminal.
            const path = match[1];
            if (!path) {
              return undefined;
            }

            // Sort out the decoration range for the link
            const line = context.line;
            const startIndex = line.indexOf(path);
            return {
              startIndex,
              length: path.length,
              tooltip: "View Scan Results",
              data: path,
            };
          })
          .filter((link) => link !== undefined);
        return result;
      }

      return undefined;
    },
    handleTerminalLink: async (link: ScanViewTerminalLink) => {
      const scanDirUri = await resolveScanDirLink(link.data);
      if (scanDirUri) {
        // Terminal output is attacker-influenceable; a remote scan location
        // would be fetched by the scout view server with the user's ambient
        // credentials. Require host-naming confirmation before opening, as the
        // other untrusted entry points do. See CWE-918.
        if (
          scanDirUri.scheme !== "file" &&
          !(await confirmRemoteOpen(scanDirUri))
        ) {
          return;
        }
        await commands.executeCommand("inspect.openScanViewer", scanDirUri);
      } else {
        // Since we couldn't resolve the log file, just let the user know
        const close: MessageItem = { title: "Close" };
        await window.showInformationMessage<MessageItem>(
          "Unable to find this scan directory within the current workspace.",
          close
        );
      }
    },
  };
};

export const resolveScanDirLink = async (link: string) => {
  if (/^[a-z0-9]+:\/\//.test(link)) {
    // This is a Uri (e.g. S3 url). Only dereference schemes we expect, and
    // never a file:// URI with a host — see parseTerminalLinkUri.
    return parseTerminalLinkUri(link) ?? undefined;
  } else {
    // This is likely a file path. Refuse UNC paths (\\host\share, //host/share)
    // whose mere existence check would open an NTLM-authenticated SMB session.
    if (isUncPath(link)) {
      return undefined;
    }
    const wsAbs = workspacePath(link);
    if (existsSync(wsAbs.path)) {
      // This is a workspace file that exists
      return Uri.file(wsAbs.path);
    } else {
      // If not found as a file, try searching for it as a directory
      // Extract the scan_id if present to make the search more specific
      const scanIdMatch = link.match(
        /scan_id=[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}/
      );
      if (scanIdMatch) {
        const scanIdDir = scanIdMatch[0];
        // Search for any files within directories matching the scan_id pattern
        const dirSearchPattern = `**/${scanIdDir}/*`;
        const filesInDir = await workspace.findFiles(dirSearchPattern, null, 1);
        if (filesInDir.length > 0) {
          // Found at least one file in a matching scan_id directory
          // Extract the directory path
          const [foundFile] = filesInDir;
          if (!foundFile) {
            return undefined;
          }
          const foundFilePath = foundFile.path;
          const scanIdIndex = foundFilePath.lastIndexOf(scanIdDir);
          if (scanIdIndex !== -1) {
            const dirPath = foundFilePath.substring(
              0,
              scanIdIndex + scanIdDir.length
            );
            return Uri.file(dirPath);
          }
        }
      }
    }

    return undefined;
  }
};
