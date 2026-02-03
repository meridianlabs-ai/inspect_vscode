import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  ExtensionContext,
  TextDocument,
  Uri,
  languages,
} from "vscode";
import { isNotebook } from "../../components/notebook";

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
    // Handle multiline imports by removing newlines between parentheses
    const normalizedText = text.replace(normalizeTextPattern, "($1)");

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
          if (match) {
            scanCommands(document.uri, match[1]).forEach(cmd => {
              lenses.push(new CodeLens(line.range, cmd));
            });
            break;
          }
          j++;
        }
      }
    }
    return lenses;
  }
}

const fromImportPattern =
  /from\s+inspect_scout\s+import\s+(?:\(\s*)?(?:[\w,\s]*,\s*)?(scanner|scanjob)(?:\s+as\s+(\w+))?/;
const hasImportPattern = /import\s+inspect_scout\b/;
const kFuncPattern = /^\s*def\s*(.*)\(.*$/;
const kDecoratorPattern = /^\s*@(inspect_scout\.)?(scanner|scanjob)\b|@(\w+)\b/;
const normalizeTextPattern = /\(\s*\n\s*([^)]+)\s*\n\s*\)/g;
