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
    // The import patterns already accept newlines; no document-wide
    // parenthesis normalization is needed (unclosed groups can be quadratic).
    const fromImportMatch = text.match(fromImportPattern);
    if (fromImportMatch) {
      return { hasImport: true, alias: fromImportMatch[1] };
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
    const importInfo = this.hasInspectImport(document);
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
            for (const command of taskCommands(document.uri, name)) {
              lenses.push(new CodeLens(range, command));
            }
          }
        }
        pendingDecorators.length = 0;
      }
      const decoratorMatch = line.text.match(kDecoratorPattern);

      if (decoratorMatch) {
        const isInspectTask =
          decoratorMatch[1] !== undefined || // @inspect.task
          decoratorMatch[0] === "@task" || // @task (when from inspect import task)
          (importInfo.alias && decoratorMatch[2] === importInfo.alias); // @t (when from inspect import task as t)

        if (!isInspectTask) {
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
