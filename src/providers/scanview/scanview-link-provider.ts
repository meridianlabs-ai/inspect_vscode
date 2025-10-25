import {
  ExtensionContext,
  MessageItem,
  window,
} from "vscode";

import { TerminalLink, TerminalLinkContext } from "vscode";

const kScanResultPattern = /([^\s"]*scan_id=[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22})/g;


interface ScanViewTerminalLink extends TerminalLink {
  data: string;
}

export const scanviewTerminalLinkProvider = (
  _context: ExtensionContext,
) => {
  
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
      await window.showInformationMessage<MessageItem>(
          `Found scandir link: ${link.data}`
        );
    },
  };
};
