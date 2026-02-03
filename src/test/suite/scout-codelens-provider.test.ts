import * as assert from "assert";
import {
  CancellationToken,
  Position,
  Range,
  TextDocument,
  TextLine,
  EndOfLine,
  Uri,
} from "vscode";
import { ScoutCodeLensProvider } from "../../providers/codelens/scout-codelens-provider";

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
    return new MockTextLine(this.lines[line], line);
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

suite("Scout CodeLens Provider Test Suite", () => {
  let provider: ScoutCodeLensProvider;
  let cancellationToken: CancellationToken;

  setup(() => {
    provider = new ScoutCodeLensProvider();
    cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
  });

  function createDocument(content: string): TextDocument {
    return new MockTextDocument(content);
  }

  test('should return code lenses when using "from inspect_scout import scanner"', () => {
    const document = createDocument(`
from inspect_scout import scanner

@scanner
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return two lenses (run and debug) for scout scanner"
    );
  });

  test('should return code lenses when using "from inspect_scout import scanner as s"', () => {
    const document = createDocument(`
from inspect_scout import scanner as s

@s
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses when scanner is imported with alias"
    );
  });

  test('should return code lenses when using "import inspect_scout"', () => {
    const document = createDocument(`
import inspect_scout

@inspect_scout.scanner
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses when using full inspect_scout import"
    );
  });

  test("should handle multiple scanner decorators in the same file", () => {
    const document = createDocument(`
from inspect_scout import scanner

@scanner
def first_scan():
    pass

@scanner
def second_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(lenses.length, 4, "Should return lenses for both scans");
  });

  test("should not return code lenses for non-scout scanner decorator", () => {
    const document = createDocument(`
from some_other_package import scanner

@scanner
def other_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should not return code lenses for non-scout scanner"
    );
  });

  test("should handle scanner decorator without following function", () => {
    const document = createDocument(`
from inspect_scout import scanner

@scanner
# Some comment here`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should handle malformed scanner decorator safely"
    );
  });

  test("should handle empty document", () => {
    const document = createDocument("");
    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(lenses.length, 0, "Should handle empty document safely");
  });

  test("should handle multiline import statements", () => {
    const document = createDocument(`
from inspect_scout import (
    ScanJob,
    scanner as s,
)

@s
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for multiline import"
    );
  });

  test("should handle multiple imports in a single line", () => {
    const document = createDocument(`
from inspect_scout import ScanJob, scanner as s

@s
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for multiple imports in a single line"
    );
  });

  test("should handle scanner decorator without import", () => {
    const document = createDocument(`
@scanner
def my_scan():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should not return lenses for scanner decorator without import"
    );
  });

  test("should return empty array when cancellation is requested", () => {
    const document = createDocument(`
from inspect_scout import scanner

@scanner
def my_scan():
    pass`);

    const cancelledToken: CancellationToken = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };

    const lenses = provider.provideCodeLenses(document, cancelledToken);
    assert.strictEqual(
      lenses.length,
      0,
      "Should return empty array when cancelled"
    );
  });

  test("should return code lenses for scanjob decorator", () => {
    const document = createDocument(`
from inspect_scout import scanjob

@scanjob
def my_job():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for scanjob decorator"
    );
  });

  test("should handle mixed scanner and scanjob decorators", () => {
    const document = createDocument(`
from inspect_scout import scanner, scanjob

@scanner
def scan_func():
    pass

@scanjob
def job_func():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      4,
      "Should return lenses for both decorators"
    );
  });

  test("should handle inspect_scout.scanjob decorator", () => {
    const document = createDocument(`
import inspect_scout

@inspect_scout.scanjob
def my_job():
    pass`);

    const lenses = provider.provideCodeLenses(document, cancellationToken);
    assert.strictEqual(
      lenses.length,
      2,
      "Should return lenses for inspect_scout.scanjob"
    );
  });
});
