/**
 * Shared mock utilities for testing view servers
 */

import { ExtensionContext, OutputChannel, Disposable } from "vscode";

/**
 * Mock ExtensionContext for testing
 */
export class MockExtensionContext implements Partial<ExtensionContext> {
  subscriptions: Array<{ dispose: () => void }> = [];
  workspaceState: any = {
    get: () => undefined,
    update: () => Promise.resolve(),
  };
  globalState: any = {
    get: () => undefined,
    update: () => Promise.resolve(),
    setKeysForSync: () => {},
  };
  extensionPath: string = "/mock/extension/path";
  extensionUri: any = { scheme: "file", path: "/mock/extension/path" };
  environmentVariableCollection: any = {
    replace: () => {},
    append: () => {},
    prepend: () => {},
    get: () => undefined,
    forEach: () => {},
    clear: () => {},
  };
  storagePath: string | undefined = "/mock/storage";
  globalStoragePath: string = "/mock/global/storage";
  logPath: string = "/mock/logs";
  extensionMode: any = 1; // Normal mode
}

/**
 * Mock PackageManager for testing
 */
export class MockPackageManager {
  private changeCallbacks: Array<() => void> = [];
  private _isAvailable: boolean = true;
  private _version: string | undefined = "1.0.0";

  onPackageChanged(callback: () => void): Disposable {
    this.changeCallbacks.push(callback);
    return {
      dispose: () => {
        const index = this.changeCallbacks.indexOf(callback);
        if (index > -1) {
          this.changeCallbacks.splice(index, 1);
        }
      },
    };
  }

  isAvailable(): boolean {
    return this._isAvailable;
  }

  getVersion(): string | undefined {
    return this._version;
  }

  setAvailable(available: boolean) {
    this._isAvailable = available;
  }

  setVersion(version: string | undefined) {
    const changed = this._version !== version;
    this._version = version;
    if (changed) {
      this.triggerChange();
    }
  }

  triggerChange() {
    this.changeCallbacks.forEach((cb) => cb());
  }
}

/**
 * Mock OutputChannel for testing
 */
export class MockOutputChannel implements OutputChannel {
  name: string;
  private _output: string = "";

  constructor(name: string) {
    this.name = name;
  }

  append(value: string): void {
    this._output += value;
  }

  appendLine(value: string): void {
    this._output += value + "\n";
  }

  clear(): void {
    this._output = "";
  }

  show(): void {
    // No-op for testing
  }

  hide(): void {
    // No-op for testing
  }

  dispose(): void {
    this._output = "";
  }

  replace(value: string): void {
    this._output = value;
  }

  getOutput(): string {
    return this._output;
  }
}

/**
 * Mock fetch response for HTTP testing
 */
export interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: () => Promise<any>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: Map<string, string>;
}

/**
 * Mock fetch call log entry
 */
export interface FetchCallLog {
  url: string;
  options: RequestInit;
}

/**
 * Fetch mock manager for testing HTTP requests
 */
export class FetchMockManager {
  private responses: Map<string, MockFetchResponse> = new Map();
  private callLog: FetchCallLog[] = [];
  private originalFetch: typeof global.fetch;

  constructor() {
    this.originalFetch = global.fetch;
  }

  /**
   * Set a mock response for a specific URL pattern
   */
  setResponse(urlPattern: string, response: Partial<MockFetchResponse>) {
    const fullResponse: MockFetchResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({}),
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Map(),
      ...response,
    };
    this.responses.set(urlPattern, fullResponse);
  }

  /**
   * Set a successful JSON response
   */
  setJsonResponse(urlPattern: string, data: any, status: number = 200) {
    this.setResponse(urlPattern, {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: async () => JSON.stringify(data),
      json: async () => data,
    });
  }

  /**
   * Set a successful binary response
   */
  setBinaryResponse(urlPattern: string, data: Uint8Array, status: number = 200) {
    const buffer = data.buffer as ArrayBuffer;
    this.setResponse(urlPattern, {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      arrayBuffer: async () => buffer,
    });
  }

  /**
   * Set an error response
   */
  setErrorResponse(urlPattern: string, status: number, message: string) {
    this.setResponse(urlPattern, {
      ok: false,
      status,
      statusText: message,
      text: async () => message,
    });
  }

  /**
   * Install the fetch mock
   */
  install() {
    global.fetch = async (
      url: string | URL | Request,
      options?: RequestInit
    ): Promise<Response> => {
      const urlString = typeof url === "string" ? url : url.toString();
      this.callLog.push({ url: urlString, options: options || {} });

      // Find matching response
      for (const [pattern, response] of this.responses) {
        if (urlString.includes(pattern)) {
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            text: response.text,
            json: response.json,
            arrayBuffer: response.arrayBuffer,
            headers: new Map(response.headers),
          } as unknown as Response;
        }
      }

      // Default response if no match
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({}),
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: new Map(),
      } as unknown as Response;
    };
  }

  /**
   * Restore original fetch
   */
  restore() {
    global.fetch = this.originalFetch;
  }

  /**
   * Get the call log
   */
  getCallLog(): FetchCallLog[] {
    return this.callLog;
  }

  /**
   * Clear the call log
   */
  clearCallLog() {
    this.callLog = [];
  }

  /**
   * Get calls matching a URL pattern
   */
  getCallsMatching(pattern: string): FetchCallLog[] {
    return this.callLog.filter((call) => call.url.includes(pattern));
  }

  /**
   * Assert that a URL was called
   */
  assertCalled(pattern: string): boolean {
    return this.getCallsMatching(pattern).length > 0;
  }

  /**
   * Reset all responses and call log
   */
  reset() {
    this.responses.clear();
    this.callLog = [];
  }
}

/**
 * Helper to create a mock fetch manager with automatic cleanup
 */
export function createFetchMock(): FetchMockManager {
  const manager = new FetchMockManager();
  manager.install();
  return manager;
}

/**
 * Mock ChildProcess for testing server lifecycle
 */
export class MockChildProcess {
  pid: number | undefined = Math.floor(Math.random() * 10000);
  exitCode: number | null = null;
  killed: boolean = false;

  private killCallbacks: Array<() => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];

  kill(signal?: string): boolean {
    this.killed = true;
    this.exitCode = signal === "SIGKILL" ? 137 : 0;
    this.killCallbacks.forEach((cb) => cb());
    return true;
  }

  onKill(callback: () => void) {
    this.killCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void) {
    this.errorCallbacks.push(callback);
  }

  triggerError(error: Error) {
    this.errorCallbacks.forEach((cb) => cb(error));
  }

  simulateExit(code: number) {
    this.exitCode = code;
  }
}

/**
 * Helper to create standard test headers
 */
export function createTestHeaders(
  additionalHeaders?: Record<string, string>
): Map<string, string> {
  const headers = new Map<string, string>();
  headers.set("Content-Type", "application/json");

  if (additionalHeaders) {
    Object.entries(additionalHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return headers;
}

/**
 * Helper to verify URL encoding
 */
export function assertUrlEncoded(encoded: string, original: string): boolean {
  return encoded !== original && decodeURIComponent(encoded) === original;
}

/**
 * Helper to create test URIs
 */
export class TestUriFactory {
  static file(path: string) {
    return {
      scheme: "file",
      path: path,
      fsPath: path,
      authority: "",
      query: "",
      fragment: "",
      toString: (_skipEncoding?: boolean) => `file://${path}`,
    };
  }

  static http(url: string) {
    const parsed = new URL(url);
    return {
      scheme: parsed.protocol.replace(":", ""),
      path: parsed.pathname,
      authority: parsed.host,
      query: parsed.search,
      fragment: parsed.hash,
      toString: () => url,
    };
  }
}

/**
 * Helper to wait for async operations in tests
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = 1000,
  interval: number = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Helper to verify error messages
 */
export function assertError(
  fn: () => void | Promise<void>,
  expectedMessage: string
): void {
  let error: Error | undefined;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((e) => {
        error = e;
      });
    }
  } catch (e) {
    error = e as Error;
  }

  if (!error) {
    throw new Error("Expected function to throw an error");
  }

  if (!error.message.includes(expectedMessage)) {
    throw new Error(
      `Expected error message to include "${expectedMessage}", but got "${error.message}"`
    );
  }
}
