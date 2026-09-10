import * as assert from "assert";

import {
  CancellationToken,
  EndOfLine,
  Position,
  Range,
  TextDocument,
  TextLine,
  Uri,
} from "vscode";

import { InspectCodeLensProvider } from "../../providers/codelens/codelens-provider";

import { assertBoundedCodeLensScan } from "./codelens-performance";

class MockTextLine implements TextLine {
  constructor(
    private lineText: string,
    private _lineNumber: number
  ) {}

  get text(): string {
    return this.lineText;
  }
  get lineNumber(): number {
    return this._lineNumber;
  }
  get range(): Range {
    return new Range(
      new Position(this._lineNumber, 0),
      new Position(this._lineNumber, this.lineText.length)
    );
  }
  get rangeIncludingLineBreak(): Range {
    return this.range;
  }
  get firstNonWhitespaceCharacterIndex(): number {
    return 0;
  }
  get isEmptyOrWhitespace(): boolean {
    return this.lineText.trim().length === 0;
  }
}

class MockTextDocument implements TextDocument {
  private lines: string[];

  constructor(content: string) {
    this.lines = content.split("\n");
  }

  get lineCount(): number {
    return this.lines.length;
  }

  lineAt(lineOrPos: number | Position): TextLine {
    const line = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line;
    return new MockTextLine(this.lines[line] ?? "", line);
  }

  getText(): string {
    return this.lines.join("\n");
  }

  // Implement other required interface members with mock values
  get uri(): Uri {
    return { scheme: "file", path: "test.py" } as Uri;
  }
  get fileName(): string {
    return "test.py";
  }
  get isUntitled(): boolean {
    return false;
  }
  get languageId(): string {
    return "python";
  }
  get version(): number {
    return 1;
  }
  get isDirty(): boolean {
    return false;
  }
  get isClosed(): boolean {
    return false;
  }
  get encoding(): string {
    return "utf-8";
  }
  save(): Thenable<boolean> {
    return Promise.resolve(true);
  }
  offsetAt(): number {
    return 0;
  }
  positionAt(): Position {
    return new Position(0, 0);
  }
  getWordRangeAtPosition(): Range | undefined {
    return undefined;
  }
  validateRange(range: Range): Range {
    return range;
  }
  validatePosition(): Position {
    return new Position(0, 0);
  }
  get eol(): EndOfLine {
    return EndOfLine.LF;
  }
}

suite("CodeLens Provider Test Suite", () => {
  let provider: InspectCodeLensProvider;
  let cancellationToken: CancellationToken;

  setup(() => {
    provider = new InspectCodeLensProvider();
    cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
  });

  function createDocument(content: string): TextDocument {
    return new MockTextDocument(content);
  }

  test('should return code lenses when using "from inspect import task"', () => {
    const document = createDocument(`
from inspect_ai import task

@task
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return two lenses (run and debug) for inspect task"
    );
  });

  test('should return code lenses when using "from inspect import task as t"', () => {
    const document = createDocument(`
from inspect_ai import task as t

@t
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses when task is imported with alias"
    );
  });

  test('should return code lenses when using "import inspect"', () => {
    const document = createDocument(`
import inspect_ai

@inspect_ai.task
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses when using full inspect import"
    );
  });

  test("should handle multiple task decorators in the same file", () => {
    const document = createDocument(`
from inspect_ai import task

@task
def first_task():
    pass

@task
def second_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(lenses.length, 4, "Should return lenses for both tasks");
  });

  test("should not return code lenses for non-inspect task decorator", () => {
    const document = createDocument(`
from pytask import task

@task
def other_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should not return code lenses for non-inspect task"
    );
  });

  test("should handle task decorator without following function", () => {
    const document = createDocument(`
from inspect import task

@task
# Some comment here`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should handle malformed task decorator safely"
    );
  });

  test("should handle empty document", () => {
    const document = createDocument("");
    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(lenses.length, 0, "Should handle empty document safely");
  });

  test("Should handle multiline import statements", () => {
    const document = createDocument(`
from inspect_ai import (
    Task,
    task as t,
)

@t
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for multiline import"
    );
  });

  test("Should handle multiple imports in a single line", () => {
    const document = createDocument(`
from inspect_ai import Task, task as t

@t
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for multiple imports in a single line"
    );
  });

  test("Should handle task decorator without import", () => {
    const document = createDocument(`
@task
def my_task():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should return lenses for task decorator without import"
    );
  });
  test("unclosed parentheses complete within a bounded time", async function () {
    this.timeout(10_000);
    await assertBoundedCodeLensScan(
      require.resolve("../../providers/codelens/codelens-provider"),
      "InspectCodeLensProvider"
    );
  });

  test("decorator scans read each line only once as input grows", () => {
    for (const count of [10_000, 100_000]) {
      const document = createDocument(
        "import inspect_ai\n" + "@task\n".repeat(count)
      );
      const originalLineAt = document.lineAt.bind(document);
      let reads = 0;
      document.lineAt = (line: number | Position) => {
        assert.ok(++reads <= document.lineCount, "repeated line scan");
        return originalLineAt(typeof line === "number" ? line : line.line);
      };
      assert.deepStrictEqual(
        provider.provideCodeLenses(document, cancellationToken),
        []
      );
      assert.strictEqual(reads, document.lineCount);
    }
  });

  test("preserves multiline decorators, stacked ranges, and command order", () => {
    const document = createDocument(
      [
        "from inspect_ai import (",
        "    task as alias,",
        ")",
        "@alias(",
        "    name='example',",
        ")",
        "@alias",
        "def example():",
        "    pass",
      ].join("\r\n")
    );
    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.deepStrictEqual(
      lenses.map((lens) => lens.range.start.line),
      [3, 3, 6, 6]
    );
    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.arguments?.[1] as unknown),
      ["example", "example", "example", "example"]
    );
    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.command),
      [
        "inspect.debugTask",
        "inspect.runTask",
        "inspect.debugTask",
        "inspect.runTask",
      ]
    );
  });

  test("stops reading lines when cancellation is observed during the scan", () => {
    const document = createDocument(
      "import inspect_ai\n" + "@task\n".repeat(1_000)
    );
    let checks = 0;
    const token: CancellationToken = {
      get isCancellationRequested() {
        return ++checks > 10;
      },
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    assert.deepStrictEqual(provider.provideCodeLenses(document, token), []);
    assert.strictEqual(checks, 11);
  });
});
