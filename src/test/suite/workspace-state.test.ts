/**
 * Tests for workspace-state-provider.ts - WorkspaceStateManager
 */
import * as assert from "assert";
import {
  WorkspaceStateManager,
  DocumentState,
  ModelState,
} from "../../providers/workspace/workspace-state-provider";

/**
 * Mock Memento for workspace state
 */
class MockMemento {
  private storage: Map<string, unknown> = new Map();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.storage.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    return value as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
  }

  keys(): readonly string[] {
    return Array.from(this.storage.keys());
  }

  // Test helper to get all stored data
  _getAll(): Map<string, unknown> {
    return new Map(this.storage);
  }

  // Test helper to clear storage
  _clear(): void {
    this.storage.clear();
  }
}

/**
 * Mock ExtensionContext for testing WorkspaceStateManager
 */
class MockExtensionContext {
  workspaceState = new MockMemento();
  globalState = new MockMemento();
  subscriptions: Array<{ dispose: () => void }> = [];
  extensionPath: string = "/mock/extension/path";
  storagePath: string | undefined = "/mock/storage";
  globalStoragePath: string = "/mock/global/storage";
  logPath: string = "/mock/logs";
}

suite("WorkspaceStateManager Test Suite", () => {
  let context: MockExtensionContext;
  let stateManager: WorkspaceStateManager;

  setup(() => {
    context = new MockExtensionContext();
    // Type assertion needed due to partial mock
    stateManager = new WorkspaceStateManager(
      context as unknown as import("vscode").ExtensionContext
    );
  });

  suite("Workspace ID Management", () => {
    test("should initialize workspace ID if not present", async () => {
      await stateManager.initializeWorkspaceId();
      const id = stateManager.getWorkspaceInstance();
      assert.ok(id, "Workspace ID should be set");
      assert.ok(id.includes("-"), "Workspace ID should contain timestamp-random format");
    });

    test("should not overwrite existing workspace ID", async () => {
      // Set initial ID
      await stateManager.initializeWorkspaceId();
      const firstId = stateManager.getWorkspaceInstance();

      // Try to initialize again
      await stateManager.initializeWorkspaceId();
      const secondId = stateManager.getWorkspaceInstance();

      assert.strictEqual(firstId, secondId, "Workspace ID should not change");
    });

    test("should generate unique workspace IDs", async () => {
      // Create two separate state managers to test ID generation
      const context1 = new MockExtensionContext();
      const context2 = new MockExtensionContext();
      const manager1 = new WorkspaceStateManager(
        context1 as unknown as import("vscode").ExtensionContext
      );
      const manager2 = new WorkspaceStateManager(
        context2 as unknown as import("vscode").ExtensionContext
      );

      await manager1.initializeWorkspaceId();
      await manager2.initializeWorkspaceId();

      const id1 = manager1.getWorkspaceInstance();
      const id2 = manager2.getWorkspaceInstance();

      // IDs should be different (with high probability)
      // Note: This could theoretically fail if generated at exact same millisecond with same random
      assert.notStrictEqual(id1, id2, "Different workspaces should have different IDs");
    });
  });

  suite("Generic State Management", () => {
    test("should set and get state values", async () => {
      await stateManager.setState("test-key", "test-value");
      const value = stateManager.getState("test-key");
      assert.strictEqual(value, "test-value");
    });

    test("should return undefined for non-existent keys", () => {
      const value = stateManager.getState("non-existent-key");
      assert.strictEqual(value, undefined);
    });

    test("should overwrite existing state values", async () => {
      await stateManager.setState("key", "value1");
      await stateManager.setState("key", "value2");
      const value = stateManager.getState("key");
      assert.strictEqual(value, "value2");
    });
  });

  suite("Task State Management", () => {
    test("should return empty object for non-existent task state", () => {
      const state = stateManager.getTaskState("/path/to/file.py", "my_task");
      assert.deepStrictEqual(state, {});
    });

    test("should set and get task state with task name", async () => {
      const taskState: DocumentState = {
        limit: "10",
        epochs: "2",
        temperature: "0.7",
      };

      await stateManager.setTaskState("/path/to/file.py", taskState, "my_task");
      const retrieved = stateManager.getTaskState("/path/to/file.py", "my_task");

      assert.deepStrictEqual(retrieved, taskState);
    });

    test("should set and get task state without task name (file-level)", async () => {
      const taskState: DocumentState = {
        limit: "5",
        maxTokens: "1000",
      };

      await stateManager.setTaskState("/path/to/file.py", taskState);
      const retrieved = stateManager.getTaskState("/path/to/file.py");

      assert.deepStrictEqual(retrieved, taskState);
    });

    test("should keep separate state for different tasks in same file", async () => {
      const state1: DocumentState = { limit: "10" };
      const state2: DocumentState = { limit: "20" };

      await stateManager.setTaskState("/path/to/file.py", state1, "task1");
      await stateManager.setTaskState("/path/to/file.py", state2, "task2");

      const retrieved1 = stateManager.getTaskState("/path/to/file.py", "task1");
      const retrieved2 = stateManager.getTaskState("/path/to/file.py", "task2");

      assert.deepStrictEqual(retrieved1, state1);
      assert.deepStrictEqual(retrieved2, state2);
    });

    test("should keep separate state for same task name in different files", async () => {
      const state1: DocumentState = { limit: "10" };
      const state2: DocumentState = { limit: "20" };

      await stateManager.setTaskState("/path/to/file1.py", state1, "my_task");
      await stateManager.setTaskState("/path/to/file2.py", state2, "my_task");

      const retrieved1 = stateManager.getTaskState("/path/to/file1.py", "my_task");
      const retrieved2 = stateManager.getTaskState("/path/to/file2.py", "my_task");

      assert.deepStrictEqual(retrieved1, state1);
      assert.deepStrictEqual(retrieved2, state2);
    });

    test("should handle all DocumentState properties", async () => {
      const fullState: DocumentState = {
        limit: "100",
        epochs: "5",
        temperature: "0.8",
        topP: "0.9",
        topK: "50",
        maxTokens: "2048",
        params: { custom1: "value1", custom2: "value2" },
        sampleIds: "1,2,3",
      };

      await stateManager.setTaskState("/path/to/file.py", fullState, "full_task");
      const retrieved = stateManager.getTaskState("/path/to/file.py", "full_task");

      assert.deepStrictEqual(retrieved, fullState);
    });

    test("should update partial state without losing other properties", async () => {
      const initialState: DocumentState = {
        limit: "10",
        epochs: "2",
        temperature: "0.7",
      };

      await stateManager.setTaskState("/path/to/file.py", initialState, "my_task");

      // Update with new state (this replaces the whole state)
      const updatedState: DocumentState = {
        ...initialState,
        limit: "20",
      };

      await stateManager.setTaskState("/path/to/file.py", updatedState, "my_task");
      const retrieved = stateManager.getTaskState("/path/to/file.py", "my_task");

      assert.strictEqual(retrieved.limit, "20");
      assert.strictEqual(retrieved.epochs, "2");
      assert.strictEqual(retrieved.temperature, "0.7");
    });
  });

  suite("Model State Management", () => {
    test("should return empty object for non-existent model state", () => {
      const state = stateManager.getModelState("openai");
      assert.deepStrictEqual(state, {});
    });

    test("should set and get model state", async () => {
      const modelState: ModelState = {
        lastModel: "gpt-4",
      };

      await stateManager.setModelState("openai", modelState);
      const retrieved = stateManager.getModelState("openai");

      assert.deepStrictEqual(retrieved, modelState);
    });

    test("should keep separate state for different providers", async () => {
      const openaiState: ModelState = { lastModel: "gpt-4" };
      const anthropicState: ModelState = { lastModel: "claude-3-opus" };

      await stateManager.setModelState("openai", openaiState);
      await stateManager.setModelState("anthropic", anthropicState);

      const retrievedOpenai = stateManager.getModelState("openai");
      const retrievedAnthropic = stateManager.getModelState("anthropic");

      assert.deepStrictEqual(retrievedOpenai, openaiState);
      assert.deepStrictEqual(retrievedAnthropic, anthropicState);
    });

    test("should update model state", async () => {
      await stateManager.setModelState("openai", { lastModel: "gpt-3.5-turbo" });
      await stateManager.setModelState("openai", { lastModel: "gpt-4" });

      const retrieved = stateManager.getModelState("openai");
      assert.strictEqual(retrieved.lastModel, "gpt-4");
    });

    test("should handle provider names with special characters", async () => {
      const state: ModelState = { lastModel: "custom-model" };

      await stateManager.setModelState("my-custom/provider", state);
      const retrieved = stateManager.getModelState("my-custom/provider");

      assert.deepStrictEqual(retrieved, state);
    });
  });

  suite("State Isolation", () => {
    test("should not conflict between task state and model state", async () => {
      // Use similar-looking keys
      await stateManager.setTaskState("provider-openai", { limit: "10" }, "task");
      await stateManager.setModelState("openai", { lastModel: "gpt-4" });

      const taskState = stateManager.getTaskState("provider-openai", "task");
      const modelState = stateManager.getModelState("openai");

      assert.deepStrictEqual(taskState, { limit: "10" });
      assert.deepStrictEqual(modelState, { lastModel: "gpt-4" });
    });

    test("should not conflict between generic state and task/model state", async () => {
      // Note: Task state without task name uses the file path as key directly,
      // so we need to use different keys or include a task name to avoid conflicts
      await stateManager.setState("generic-key", "generic-value");
      await stateManager.setTaskState("/path/to/file.py", { limit: "10" }, "my_task");

      const genericState = stateManager.getState("generic-key");
      const taskState = stateManager.getTaskState("/path/to/file.py", "my_task");

      assert.strictEqual(genericState, "generic-value");
      assert.deepStrictEqual(taskState, { limit: "10" });
    });
  });
});
