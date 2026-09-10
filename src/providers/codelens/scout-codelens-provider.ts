import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  ExtensionContext,
  languages,
  Range,
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
    // The import patterns already accept newlines; no document-wide
    // parenthesis normalization is needed (unclosed groups can be quadratic).
    const fromImportMatch = text.match(fromImportPattern);
    if (fromImportMatch) {
      return { hasImport: true, alias: fromImportMatch[2] };
    }
    if (hasImportPattern.test(text)) {
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
    const pendingDecorators: Range[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      if (token.isCancellationRequested) {
        return [];
      }
      const line = document.lineAt(i);
      const functionMatch = line.text.match(kFuncPattern);
      if (functionMatch?.[1]) {
        const name = functionMatch[1];
        if (isValidTaskName(name)) {
          for (const range of pendingDecorators) {
            for (const command of scanCommands(document.uri, name)) {
              lenses.push(new CodeLens(range, command));
            }
          }
        }
        pendingDecorators.length = 0;
      }
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

        // Resolve all preceding decorators at the next function in one pass,
        // rather than searching the remaining document from each decorator.
        pendingDecorators.push(line.range);
      }
    }
    return lenses;
  }
}

// Linear-time rewrite (see the matching comment in codelens-provider.ts):
// prior import names are `\w+` elements separated by `\s*,\s*` with no two
// whitespace quantifiers adjacent. Group 1 stays (scanner|scanjob), group 2
// the alias. Multiline imports match directly.
const fromImportPattern =
  /from\s+inspect_scout\s+import\s+(?:\(\s*)?(?:\w+\s*,\s*)*(scanner|scanjob)\b(?:\s+as\s+(\w+))?/;
const hasImportPattern = /import\s+inspect_scout\b/;
// Linear-time: the identifier is constrained to `[A-Za-z_]\w*` with the `(`
// following immediately, so there are no adjacent overlapping quantifiers (see
// the matching comment/finding in codelens-provider.ts).
const kFuncPattern = /^\s*def\s+([A-Za-z_]\w*)\s*\(/;
const kDecoratorPattern = /^\s*@(inspect_scout\.)?(scanner|scanjob)\b|@(\w+)\b/;
