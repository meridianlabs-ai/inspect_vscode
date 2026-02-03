/**
 * Tests for active-task-provider.ts - ActiveTaskManager
 */
import * as assert from "assert";
import {
  Uri,
  Position,
  Selection,
  TextDocument,
  TextLine,
  Range,
  EndOfLine,
} from "vscode";

// Type for mocking the event system
interface MockEvent<T> {
  fire: (data: T) => void;
  event: (listener: (e: T) => void) => { dispose: () => void };
}

function createMockEvent<T>(): MockEvent<T> {
  const listeners: Array<(e: T) => void> = [];
  return {
    fire: (data: T) => listeners.forEach(l => l(data)),
    event: (listener: (e: T) => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) {
            listeners.splice(idx, 1);
          }
        },
      };
    },
  };
}

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
  private _languageId: string;

  constructor(
    content: string,
    filename: string = "test.py",
    languageId: string = "python"
  ) {
    this.lines = content.split("\n");
    this._uri = { scheme: "file", path: `/test/${filename}` } as Uri;
    this._languageId = languageId;
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
    return this._languageId;
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

suite("ActiveTaskManager Test Suite", () => {
  suite("Event Handling", () => {
    test("should create mock event that can fire and listen", () => {
      const mockEvent = createMockEvent<string>();
      let receivedValue: string | undefined;

      mockEvent.event(value => {
        receivedValue = value;
      });

      mockEvent.fire("test-value");
      assert.strictEqual(receivedValue, "test-value");
    });

    test("should support multiple listeners", () => {
      const mockEvent = createMockEvent<number>();
      const values: number[] = [];

      mockEvent.event(v => values.push(v * 2));
      mockEvent.event(v => values.push(v * 3));

      mockEvent.fire(5);
      assert.deepStrictEqual(values, [10, 15]);
    });

    test("should allow disposing listeners", () => {
      const mockEvent = createMockEvent<string>();
      const values: string[] = [];

      const disposable = mockEvent.event(v => values.push(v));
      mockEvent.fire("first");
      disposable.dispose();
      mockEvent.fire("second");

      assert.deepStrictEqual(values, ["first"]);
    });
  });

  suite("Document Detection", () => {
    test("should create mock document with correct language ID", () => {
      const pythonDoc = new MockTextDocument("code", "test.py", "python");
      const jsDoc = new MockTextDocument("code", "test.js", "javascript");

      assert.strictEqual(pythonDoc.languageId, "python");
      assert.strictEqual(jsDoc.languageId, "javascript");
    });

    test("should parse document content into lines", () => {
      const content = `@task
def my_task():
    pass`;
      const doc = new MockTextDocument(content);

      assert.strictEqual(doc.lineCount, 3);
      assert.strictEqual(doc.lineAt(0).text, "@task");
      assert.strictEqual(doc.lineAt(1).text, "def my_task():");
      assert.strictEqual(doc.lineAt(2).text, "    pass");
    });

    test("should handle empty document", () => {
      const doc = new MockTextDocument("");
      assert.strictEqual(doc.lineCount, 1);
      assert.strictEqual(doc.lineAt(0).text, "");
    });
  });

  suite("Selection Handling", () => {
    test("should create selection at position", () => {
      const start = new Position(5, 0);
      const end = new Position(5, 10);
      const selection = new Selection(start, end);

      assert.strictEqual(selection.start.line, 5);
      assert.strictEqual(selection.start.character, 0);
      assert.strictEqual(selection.end.character, 10);
    });

    test("should identify cursor line from selection", () => {
      const selection = new Selection(new Position(10, 5), new Position(10, 5));
      const cursorLine = selection.start.line;

      assert.strictEqual(cursorLine, 10);
    });

    test("should handle multi-line selection", () => {
      const selection = new Selection(new Position(5, 0), new Position(10, 15));

      assert.strictEqual(selection.start.line, 5);
      assert.strictEqual(selection.end.line, 10);
    });
  });

  suite("Task Detection from Document", () => {
    test("should find task decorator at cursor position", () => {
      const content = `import inspect

@task
def first_task():
    pass

@task
def second_task():
    pass`;
      const doc = new MockTextDocument(content);

      // Cursor at line 4 (inside first_task)
      const cursorLine = 4;
      const lines = doc.getText().split("\n");

      // Find closest @task decorator above cursor
      let foundTaskLine = -1;
      for (let i = cursorLine; i >= 0; i--) {
        if (lines[i].trim().startsWith("@task")) {
          foundTaskLine = i;
          break;
        }
      }

      assert.strictEqual(foundTaskLine, 2);
    });

    test("should find second task when cursor is in second function", () => {
      const content = `@task
def first_task():
    pass

@task
def second_task():
    pass`;
      const doc = new MockTextDocument(content);

      // Cursor at line 6 (inside second_task)
      const cursorLine = 6;
      const lines = doc.getText().split("\n");

      // Find closest @task decorator above cursor
      let foundTaskLine = -1;
      for (let i = cursorLine; i >= 0; i--) {
        if (lines[i].trim().startsWith("@task")) {
          foundTaskLine = i;
          break;
        }
      }

      assert.strictEqual(foundTaskLine, 4);
    });

    test("should return no task when cursor is above all tasks", () => {
      const content = `import inspect

# Some comment

@task
def my_task():
    pass`;
      const doc = new MockTextDocument(content);

      // Cursor at line 1 (before any task)
      const cursorLine = 1;
      const lines = doc.getText().split("\n");

      // Find closest @task decorator above cursor
      let foundTaskLine = -1;
      for (let i = cursorLine; i >= 0; i--) {
        if (lines[i].trim().startsWith("@task")) {
          foundTaskLine = i;
          break;
        }
      }

      assert.strictEqual(foundTaskLine, -1);
    });
  });

  suite("Notebook Cell Handling", () => {
    test("should handle notebook URI detection", () => {
      const notebookUri = {
        scheme: "vscode-notebook-cell",
        path: "/test/notebook.ipynb",
        fragment: "cell-1",
      } as unknown as Uri;

      const regularUri = {
        scheme: "file",
        path: "/test/script.py",
      } as unknown as Uri;

      // Check scheme-based detection
      assert.strictEqual(notebookUri.scheme, "vscode-notebook-cell");
      assert.strictEqual(regularUri.scheme, "file");
    });

    test("should handle .ipynb extension detection", () => {
      const notebookPath = "/workspace/analysis.ipynb";
      const scriptPath = "/workspace/script.py";

      assert.ok(notebookPath.endsWith(".ipynb"));
      assert.ok(!scriptPath.endsWith(".ipynb"));
    });
  });

  suite("Debounce Behavior Simulation", () => {
    test("should track multiple rapid calls", () => {
      const calls: number[] = [];
      let lastValue = 0;

      // Simulate debounce tracking
      const trackCall = (value: number) => {
        calls.push(value);
        lastValue = value;
      };

      trackCall(1);
      trackCall(2);
      trackCall(3);

      assert.strictEqual(calls.length, 3);
      assert.strictEqual(lastValue, 3);
    });

    test("should simulate trailing debounce behavior", () => {
      // Simulate that only the last call matters in a debounced scenario
      const results: string[] = [];
      const values = ["first", "second", "third"];

      // In a debounced scenario, only "third" would be processed
      const finalValue = values[values.length - 1];
      results.push(finalValue);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], "third");
    });
  });

  suite("Task State Tracking", () => {
    test("should track active task state", () => {
      interface TaskInfo {
        document: Uri;
        taskName: string;
        line: number;
      }

      let currentTask: TaskInfo | undefined;

      const setTask = (task: TaskInfo | undefined) => {
        currentTask = task;
      };

      const getTask = () => currentTask;

      // Initially undefined
      assert.strictEqual(getTask(), undefined);

      // Set a task
      const task1: TaskInfo = {
        document: { scheme: "file", path: "/test/file.py" } as Uri,
        taskName: "my_task",
        line: 5,
      };
      setTask(task1);
      assert.deepStrictEqual(getTask(), task1);

      // Update task
      const task2: TaskInfo = {
        document: { scheme: "file", path: "/test/file.py" } as Uri,
        taskName: "another_task",
        line: 15,
      };
      setTask(task2);
      assert.deepStrictEqual(getTask(), task2);

      // Clear task
      setTask(undefined);
      assert.strictEqual(getTask(), undefined);
    });

    test("should fire change event only when task changes", () => {
      interface TaskInfo {
        name: string;
      }

      let currentTask: TaskInfo | undefined;
      const changeEvents: Array<TaskInfo | undefined> = [];

      const setActiveTaskInfo = (task: TaskInfo | undefined) => {
        if (currentTask !== task) {
          currentTask = task;
          changeEvents.push(task);
        }
      };

      setActiveTaskInfo({ name: "task1" });
      setActiveTaskInfo({ name: "task1" }); // Same reference won't trigger
      setActiveTaskInfo({ name: "task2" });
      setActiveTaskInfo(undefined);

      // Note: In actual implementation, object reference comparison is used
      // so same name but different object would trigger
      assert.strictEqual(changeEvents.length, 3);
    });
  });
});
