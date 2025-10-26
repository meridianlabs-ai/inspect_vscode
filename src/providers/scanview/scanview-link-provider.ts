import {
  commands,
  ExtensionContext,
  MessageItem,
  Uri,
  window,
  workspace,
} from "vscode";

import { TerminalLink, TerminalLinkContext } from "vscode";
import { workspacePath } from "../../core/path";
import { existsSync } from "fs";

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
        const result = matches.map(match => {
          // The path from the terminal.
          const path = match[1];

          // Sort out the decoration range for the link
          const line = context.line;
          const startIndex = line.indexOf(path);
          return {
            startIndex,
            length: path.length,
            tooltip: "View Scan Results",
            data: path,
          } as ScanViewTerminalLink;
        });
        return result;
      }

      return undefined;
    },
    handleTerminalLink: async (link: ScanViewTerminalLink) => {
      const scanDirUri = await resolveScanDirLink(link.data);
      if (scanDirUri) {
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
    // This is a Uri - just parse it and return
    // (e.g. S3 url)
    return Uri.parse(link);
  } else {
    // This is likely a file path.
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
          const foundFilePath = filesInDir[0].path;
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
