import { TextDocument, Uri } from "vscode";

import { lines } from "../core/text";

// Task information for a document
export interface DocumentTaskInfo {
  document: Uri;
  tasks: TaskData[];
  activeTask?: TaskData;
}

// Describes the current active task
export interface TaskData {
  name: string;
  params: string[];
  line: number;
}

// Reads tasks from a TextDocument
// Quickly reads the default task using text based parsing
// This can't properly deal with things like selection, so this should only
// be used when no selection behavior is warranted
const kTaskPattern = /@task/;
// Linear-time: the identifier is constrained to `[A-Za-z_]\w*` and the `(` must
// follow immediately (after optional spaces), so there are no adjacent
// overlapping quantifiers around a possibly-absent literal. The previous
// `/def\s+(.*)\((.*)$/` paired `\s+` with a greedy `(.*)` before a `\(` a
// crafted line could omit, backtracking O(n^2) on `def` + a long space/`def x `
// run (see the ReDoS finding). The parameter text is derived by slicing the
// remainder of the line after this match rather than a second overlapping group.
const kFunctionNamePattern = /def\s+([A-Za-z_]\w*)\s*\(/;

/**
 * Whether a parsed task/function name is a plain Python identifier.
 *
 * The `def (.*)\(` parsers are deliberately loose and can capture flag- or
 * shell-metacharacter-bearing text from crafted source (e.g. a fake
 * `def demo,--model-base-url,https://x(` or `def demo’;calc;‘(`). Such a
 * "name" is later embedded in the `inspect eval <path>@<name>` command line,
 * so validating it as an identifier before it is surfaced to a run command
 * keeps injection payloads off the command line (matches the identifier check
 * the task-outline tree already applies).
 */
export function isValidTaskName(name: string): boolean {
  return /^[A-Za-z_]\w*$/.test(name);
}

// Matches the end of a function signature — the closing ')' with an optional
// '-> ret' annotation and the ':'. Linear-time: the previous patterns
// backtracked quadratically on a long line of spaces (a ~2 MB param line froze
// the extension host — see ReDoS finding). kParamsPattern's lazy (.*?)
// overlapped its following \s*, and this pattern's leading \s* made .test()
// re-scan the whole space run at every start offset. Dropping the leading \s*
// makes each start offset fail immediately unless a ')' is present, and the
// parameter text is derived from this single match (everything before the
// closing ')') rather than a second, overlapping regex.
const kFunctionEndPattern = /\)\s*(?:->\s*\S+\s*)?:/;

// Defensive cap on the text handed to the parsing regexes, independent of the
// patterns themselves: a real function-signature line is never this long, and
// bounding it ensures a pathological file cannot block the extension host.
const kMaxParamsLineLength = 100_000;

export function readTaskData(document: TextDocument): TaskData[] {
  const tasks: TaskData[] = [];
  const docLines = lines(document.getText());

  let state: "seeking-task" | "seeking-function" | "reading-params" =
    "seeking-task";
  let startLine = -1;
  docLines.forEach((line, idx) => {
    switch (state) {
      case "seeking-task":
        if (kTaskPattern.test(line)) {
          startLine = idx;
          state = "seeking-function";
        }
        break;
      case "seeking-function":
        {
          // Bound the text handed to the matcher on every entry path (including
          // notebook cells via cellTasks) so a pathological line can't block the
          // extension host even if a pattern regresses.
          const fnLine =
            line.length > kMaxParamsLineLength
              ? line.slice(0, kMaxParamsLineLength)
              : line;
          const match = fnLine.match(kFunctionNamePattern);
          if (match) {
            const fnName = (match[1] ?? "").trim();
            // A crafted `def <flags/metacharacters>(` is not a real task; only
            // surface identifier-named functions so the name can't carry an
            // injection payload onto the run command line.
            if (!isValidTaskName(fnName)) {
              state = "seeking-task";
              break;
            }
            const task: TaskData = {
              name: fnName,
              params: [],
              line: startLine,
            };
            tasks.push(task);

            const restOfLine = fnLine.slice(
              (match.index ?? 0) + match[0].length
            );
            const keepReading = readParams(restOfLine, task);
            if (keepReading) {
              state = "reading-params";
            } else {
              // We've read the complete function, go
              // back to seeking tasks
              state = "seeking-task";
            }
          }
        }
        break;
      case "reading-params": {
        const currentTask = tasks[tasks.length - 1];
        if (!currentTask) {
          break;
        }
        const keepReading = readParams(line, currentTask);
        if (keepReading) {
          state = "reading-params";
        } else {
          // We've read the complete function, go
          // back to seeking tasks
          state = "seeking-task";
        }
      }
    }
  });
  return tasks;
}

const readParams = (rawLine: string, task: TaskData) => {
  const line =
    rawLine.length > kMaxParamsLineLength
      ? rawLine.slice(0, kMaxParamsLineLength)
      : rawLine;
  // A single match locates the signature end (if any). The parameter text is
  // everything before the closing ')'; if the signature does not end on this
  // line, the whole line is parameter text and we keep reading.
  const endMatch = line.match(kFunctionEndPattern);
  const paramsStr = endMatch ? line.slice(0, endMatch.index) : line;
  if (paramsStr) {
    const params = parseParameters(paramsStr);
    params.forEach((param) => {
      task.params.push(param.trim());
    });
  }
  return endMatch === null;
};

const parseParameters = (paramStr: string): string[] => {
  let bracketDepth = 0;
  let currentParam = "";
  const params: string[] = [];

  // Accumulate chars, tracking brackets and only
  // pay attention to commas outside brackets
  for (let i = 0; i < paramStr.length; i++) {
    const char = paramStr[i];
    if (!char) {
      continue;
    }

    if (["[", "(", "{"].includes(char)) {
      bracketDepth++;
      currentParam += char;
    } else if (["]", ")", "}"].includes(char)) {
      bracketDepth--;
      currentParam += char;
    } else if (char === "," && bracketDepth === 0) {
      params.push(currentParam.trim());
      currentParam = "";
    } else {
      currentParam += char;
    }
  }

  // Add the last parameter (since there was no trailing comma)
  if (currentParam.trim()) {
    params.push(currentParam.trim());
  }

  // Extract parameter names
  return params
    .map((param) => {
      // Get everything before the colon (the parameter name)
      const nameMatch = param.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
      return nameMatch ? (nameMatch[1] ?? "") : "";
    })
    .filter(Boolean);
};
