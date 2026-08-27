import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  ExtensionContext,
  languages,
  TextDocument,
  Uri,
} from "vscode";

import { isNotebook } from "../../components/notebook";
import { isValidTaskName } from "../../components/task";

export function activateScoutCodeLens(context: ExtensionContext) {
  const provider = new ScoutCodeLensProvider();
  const selector = { language: "python" };
  context.subscriptions.push(
    languages.registerCodeLensProvider(selector, provider)
  );
}

// The Code Lens commands
function scanCommands(uri: Uri, fn: string): Command[] {
  if (isNotebook(uri)) {
    return [
      {
        title: "$(play) Run Scan",
        tooltip: "Execute this scan.",
        command: "inspect.runScoutScan",
        arguments: [uri, fn],
      },
    ];
  } else {
    return [
      {
        title: "$(debug-alt) Debug Scan",
        tooltip: "Debug this scan.",
        command: "inspect.debugScoutScan",
        arguments: [uri, fn],
      },
      {
        title: "$(play) Run Scan",
        tooltip: "Execute this scan.",
        command: "inspect.runScoutScan",
        arguments: [uri, fn],
      },
    ];
  }
}

export class ScoutCodeLensProvider implements CodeLensProvider {
  private hasScoutImport(document: TextDocument): {
    hasImport: boolean;
    alias?: string;
  } {
    const text = document.getText();
    // Handle multiline imports by collapsing whitespace within parentheses
    const normalizedText = text.replace(
      normalizeTextPattern,
      (_m, inner: string) => `(${inner.replace(/\s+/g, " ")})`
    );

    const fromImportMatch = normalizedText.match(fromImportPattern);
    if (fromImportMatch) {
      return { hasImport: true, alias: fromImportMatch[2] };
    }
    if (hasImportPattern.test(normalizedText)) {
      return { hasImport: true };
    }
    return { hasImport: false };
  }

  provideCodeLenses(
    document: TextDocument,
    token: CancellationToken
  ): CodeLens[] {
    const lenses: CodeLens[] = [];

    // respect cancellation request
    if (token.isCancellationRequested) {
      return [];
    }

    // Check for inspect import first
    const importInfo = this.hasScoutImport(document);
    if (!importInfo.hasImport) {
      return [];
    }

    // Go through line by line and show a lens
    // for any task decorated functions
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const decoratorMatch = line.text.match(kDecoratorPattern);

      if (decoratorMatch) {
        const isScoutScan =
          decoratorMatch[1] !== undefined || // @inspect.scanner
          decoratorMatch[0] === "@scanner" || // @scanner (when e.g. from inspect_scout import scanner)
          decoratorMatch[0] === "@scanjob" ||
          (importInfo.alias && decoratorMatch[3] === importInfo.alias); // @s (when from inspect_scout import scanner as s)

        if (!isScoutScan) {
          continue;
        }

        // Get the function name from the next line
        let j = i + 1;
        while (j < document.lineCount) {
          const funcLine = document.lineAt(j);
          const match = funcLine.text.match(kFuncPattern);
          if (match && match[1]) {
            // Only offer a Run lens for identifier-named scanners; a loosely
            // parsed name carrying flags/metacharacters must not reach the
            // run command line.
            const name = match[1].trim();
            if (isValidTaskName(name)) {
              scanCommands(document.uri, name).forEach((cmd) => {
                lenses.push(new CodeLens(line.range, cmd));
              });
            }
            break;
          }
          j++;
        }
      }
    }
    return lenses;
  }
}

// Linear-time rewrite (see the matching comment in codelens-provider.ts):
// prior import names are `\w+` elements separated by `\s*,\s*` with no two
// whitespace quantifiers adjacent, and normalizeTextPattern scans each
// parenthesized group once. Group 1 stays (scanner|scanjob), group 2 the alias.
const fromImportPattern =
  /from\s+inspect_scout\s+import\s+(?:\(\s*)?(?:\w+\s*,\s*)*(scanner|scanjob)\b(?:\s+as\s+(\w+))?/;
const hasImportPattern = /import\s+inspect_scout\b/;
// Linear-time: the identifier is constrained to `[A-Za-z_]\w*` with the `(`
// following immediately, so there are no adjacent overlapping quantifiers (see
// the matching comment/finding in codelens-provider.ts).
const kFuncPattern = /^\s*def\s+([A-Za-z_]\w*)\s*\(/;
const kDecoratorPattern = /^\s*@(inspect_scout\.)?(scanner|scanjob)\b|@(\w+)\b/;
const normalizeTextPattern = /\(([^)]*)\)/g;
