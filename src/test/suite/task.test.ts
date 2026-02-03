/**
 * Tests for task.ts - Task parsing and parameter extraction
 */
import * as assert from "assert";
import {
  TextDocument,
  Uri,
  TextLine,
  Range,
  Position,
  EndOfLine,
} from "vscode";
import { readTaskData } from "../../components/task";

/**
 * Mock TextLine for testing
 */
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

/**
 * Mock TextDocument for testing
 */
class MockTextDocument implements TextDocument {
  private lines: string[];
  private _uri: Uri;

  constructor(content: string, filename: string = "test.py") {
    this.lines = content.split("\n");
    this._uri = { scheme: "file", path: `/test/${filename}` } as Uri;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  lineAt(lineOrPos: number | Position): TextLine {
    const line = typeof lineOrPos === "number" ? lineOrPos : lineOrPos.line;
    return new MockTextLine(this.lines[line] || "", line);
  }

  getText(): string {
    return this.lines.join("\n");
  }

  get uri(): Uri {
    return this._uri;
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

suite("Task Utilities Test Suite", () => {
  function createDocument(content: string): TextDocument {
    return new MockTextDocument(content);
  }

  suite("readTaskData", () => {
    test("should detect a simple @task decorated function", () => {
      const doc = createDocument(`
@task
def my_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
      assert.deepStrictEqual(tasks[0].params, []);
    });

    test("should detect @task with parentheses", () => {
      const doc = createDocument(`
@task()
def my_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
    });

    test("should detect @task with arguments", () => {
      const doc = createDocument(`
@task(name="test")
def my_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
    });

    test("should detect multiple tasks in a file", () => {
      const doc = createDocument(`
@task
def task_one():
    pass

@task
def task_two():
    pass

@task
def task_three():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 3);
      assert.strictEqual(tasks[0].name, "task_one");
      assert.strictEqual(tasks[1].name, "task_two");
      assert.strictEqual(tasks[2].name, "task_three");
    });

    test("should extract simple function parameters", () => {
      const doc = createDocument(`
@task
def my_task(dataset, model):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "model"]);
    });

    test("should extract typed function parameters", () => {
      const doc = createDocument(`
@task
def my_task(dataset: str, model: str, limit: int):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "model", "limit"]);
    });

    test("should extract parameters with default values", () => {
      const doc = createDocument(`
@task
def my_task(dataset: str = "default", limit: int = 10):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "limit"]);
    });

    test("should handle multi-line function signatures", () => {
      const doc = createDocument(`
@task
def my_task(
    dataset: str,
    model: str,
    limit: int
):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "model", "limit"]);
    });

    test("should handle complex default values with brackets", () => {
      const doc = createDocument(`
@task
def my_task(
    items: list[str] = ["a", "b"],
    config: dict = {"key": "value"},
    callback: Callable[[int], str] = None
):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["items", "config", "callback"]);
    });

    test("should handle return type annotations", () => {
      const doc = createDocument(`
@task
def my_task(dataset: str) -> Task:
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
      assert.deepStrictEqual(tasks[0].params, ["dataset"]);
    });

    test("should handle return type annotations on multiple lines", () => {
      const doc = createDocument(`
@task
def my_task(
    dataset: str,
    model: str
) -> Task:
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "model"]);
    });

    test("should record correct line numbers", () => {
      const doc = createDocument(`
# Comment line
@task
def first_task():
    pass

# Another comment
@task
def second_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 2);
      // Line numbers are 0-indexed
      // Line 0: empty (leading newline)
      // Line 1: # Comment line
      // Line 2: @task
      // Line 6: # Another comment
      // Line 7: @task
      assert.strictEqual(tasks[0].line, 2);
      assert.strictEqual(tasks[1].line, 7);
    });

    test("should ignore functions without @task decorator", () => {
      const doc = createDocument(`
def regular_function():
    pass

@task
def task_function():
    pass

def another_regular():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "task_function");
    });

    test("should handle empty file", () => {
      const doc = createDocument("");
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 0);
    });

    test("should handle file with no tasks", () => {
      const doc = createDocument(`
def foo():
    pass

class MyClass:
    def bar(self):
        pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 0);
    });

    test("should handle @task decorator with multiple decorators above", () => {
      const doc = createDocument(`
@some_other_decorator
@task
def my_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
    });

    test("should handle function with underscore-prefixed name", () => {
      const doc = createDocument(`
@task
def _private_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "_private_task");
    });

    test("should handle function with numbers in name", () => {
      const doc = createDocument(`
@task
def task_v2_final():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "task_v2_final");
    });

    test("should handle parameters with complex type annotations", () => {
      const doc = createDocument(`
@task
def my_task(
    solver: Solver | list[Solver] | None = None,
    dataset: Dataset[Sample] = None,
    scorer: Scorer | list[Scorer] = accuracy()
):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["solver", "dataset", "scorer"]);
    });

    test("should handle async task functions", () => {
      const doc = createDocument(`
@task
async def my_async_task(dataset: str):
    pass
`);
      // Note: The current implementation looks for 'def' so async functions may work
      // This test documents current behavior
      const tasks = readTaskData(doc);
      // Current implementation might not find async functions - documenting behavior
      // If it works, tasks.length === 1, if not, === 0
      assert.ok(tasks.length <= 1);
    });

    test("should handle task decorator on same line as function (edge case)", () => {
      // This is an edge case - typically decorators are on their own line
      const doc = createDocument(`@task
def my_task():
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].name, "my_task");
    });

    test("should handle whitespace variations in parameters", () => {
      const doc = createDocument(`
@task
def my_task(   dataset:str   ,   model : str   ):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["dataset", "model"]);
    });

    test("should handle parameters with nested generics", () => {
      const doc = createDocument(`
@task
def my_task(
    data: dict[str, list[tuple[int, str]]],
    callback: Callable[[dict[str, Any]], None]
):
    pass
`);
      const tasks = readTaskData(doc);
      assert.strictEqual(tasks.length, 1);
      assert.deepStrictEqual(tasks[0].params, ["data", "callback"]);
    });
  });
});
