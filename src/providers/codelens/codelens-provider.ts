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

export function activateCodeLens(context: ExtensionContext) {
  const provider = new InspectCodeLensProvider();
  const selector = { language: "python" };
  context.subscriptions.push(
    languages.registerCodeLensProvider(selector, provider)
  );
}

// The Code Lens commands
function taskCommands(uri: Uri, fn: string): Command[] {
  if (isNotebook(uri)) {
    return [
      {
        title: "$(play) Run Task",
        tooltip: "Execute this evaluation task.",
        command: "inspect.runTask",
        arguments: [uri, fn],
      },
    ];
  } else {
    return [
      {
        title: "$(debug-alt) Debug Task",
        tooltip: "Debug this evaluation task.",
        command: "inspect.debugTask",
        arguments: [uri, fn],
      },
      {
        title: "$(play) Run Task",
        tooltip: "Execute this evaluation task.",
        command: "inspect.runTask",
        arguments: [uri, fn],
      },
    ];
  }
}

export class InspectCodeLensProvider implements CodeLensProvider {
  private hasInspectImport(document: TextDocument): {
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
      return { hasImport: true, alias: fromImportMatch[1] };
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
    const importInfo = this.hasInspectImport(document);
    if (!importInfo.hasImport) {
      return [];
    }

    // Go through line by line and show a lens
    // for any task decorated functions
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const decoratorMatch = line.text.match(kDecoratorPattern);

      if (decoratorMatch) {
        const isInspectTask =
          decoratorMatch[1] !== undefined || // @inspect.task
          decoratorMatch[0] === "@task" || // @task (when from inspect import task)
          (importInfo.alias && decoratorMatch[2] === importInfo.alias); // @t (when from inspect import task as t)

        if (!isInspectTask) {
          continue;
        }

        // Get the function name from the next line
        let j = i + 1;
        while (j < document.lineCount) {
          const funcLine = document.lineAt(j);
          const match = funcLine.text.match(kFuncPattern);
          if (match && match[1]) {
            // Only offer a Run lens for identifier-named tasks; a loosely
            // parsed name carrying flags/metacharacters must not reach the
            // run command line.
            const name = match[1].trim();
            if (isValidTaskName(name)) {
              taskCommands(document.uri, name).forEach((cmd) => {
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

// Linear-time: prior import names are matched as `\w+` elements separated by
// `\s*,\s*`. No two whitespace-matching quantifiers are ever adjacent (the
// optional `\s*` after `(` only exists when `(` matched, and elements are
// comma-separated), so the engine cannot backtrack super-linearly on a long
// run of spaces/commas that never reaches `task`. The previous `[\w,\s]*`
// overlapped the separator and surrounding whitespace, giving O(n^2) — see
// the ReDoS finding. `\s` spans newlines, so multiline imports match directly.
const fromImportPattern =
  /from\s+inspect_ai\s+import\s+(?:\(\s*)?(?:\w+\s*,\s*)*task\b(?:\s+as\s+(\w+))?/;
const hasImportPattern = /import\s+inspect_ai\b/;
// Linear-time: the identifier is constrained to `[A-Za-z_]\w*` with the `(`
// following immediately, so there are no adjacent overlapping quantifiers. The
// previous `/^\s*def\s*(.*)\(.*$/` overlapped `\s*` and `(.*)` before a possibly
// absent `\(`, backtracking O(n^2) on `def` + a long whitespace run (see the
// ReDoS finding).
const kFuncPattern = /^\s*def\s+([A-Za-z_]\w*)\s*\(/;
const kDecoratorPattern = /^\s*@(inspect_ai\.)?task\b|@(\w+)\b/;
// Linear-time: `[^)]*` has no adjacent overlapping quantifier, so it scans each
// parenthesized group once (the previous `\(\s*\n\s*([^)]+)\s*\n\s*\)` had
// overlapping `\s*`/`[^)]+` quantifiers that backtracked quadratically on an
// unclosed '(' followed by a long whitespace run).
const normalizeTextPattern = /\(([^)]*)\)/g;
