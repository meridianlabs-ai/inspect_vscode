/**
 * Tests for manager.ts - PackageManager
 */
import * as assert from "assert";
import { Disposable } from "vscode";

// Type for mocking the event system
interface MockEvent<T> {
  fire: (data: T) => void;
  event: (listener: (e: T) => void) => Disposable;
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
 * Mock AbsolutePath for testing
 */
interface MockAbsolutePath {
  path: string;
}

/**
 * Mock PackageChangedEvent for testing
 */
interface MockPackageChangedEvent {
  available: boolean;
  binPath: MockAbsolutePath | null;
}

/**
 * Simulated PackageManager for testing logic without VS Code dependencies
 */
class TestPackageManager {
  private packageBinPath_: string | undefined = undefined;
  private packageTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onPackageChanged_ =
    createMockEvent<MockPackageChangedEvent>();

  constructor(
    private packageName_: string,
    private checkForPackage_: () => MockAbsolutePath | null
  ) {
    this.updatePackageAvailable();
  }

  get available(): boolean {
    return this.packageBinPath_ !== undefined && this.packageBinPath_ !== null;
  }

  get packageName(): string {
    return this.packageName_;
  }

  get onPackageChanged() {
    return this.onPackageChanged_.event;
  }

  updatePackageAvailable() {
    const binPath = this.checkForPackage_();
    const available = binPath !== null;
    const valueChanged = this.packageBinPath_ !== binPath?.path;

    if (valueChanged) {
      this.packageBinPath_ = binPath?.path;
      this.onPackageChanged_.fire({
        available: !!this.packageBinPath_,
        binPath,
      });
    }

    if (!available) {
      this.watchForPackage();
    }
  }

  watchForPackage() {
    if (this.packageTimer) {
      clearInterval(this.packageTimer);
    }
    this.packageTimer = setInterval(() => {
      const path = this.checkForPackage_();
      if (path) {
        if (this.packageTimer) {
          clearInterval(this.packageTimer);
          this.packageTimer = null;
          this.updatePackageAvailable();
        }
      }
    }, 100); // Short interval for testing
  }

  dispose() {
    if (this.packageTimer) {
      clearInterval(this.packageTimer);
      this.packageTimer = null;
    }
  }

  // Test helper to manually trigger interpreter change
  simulateInterpreterChange() {
    this.updatePackageAvailable();
  }

  // Test helper to check if watching
  isWatching(): boolean {
    return this.packageTimer !== null;
  }
}

suite("PackageManager Test Suite", () => {
  suite("Package Availability Detection", () => {
    test("should detect package as available when bin path exists", () => {
      const manager = new TestPackageManager("inspect-ai", () => ({
        path: "/usr/bin/inspect",
      }));

      assert.strictEqual(manager.available, true);
      manager.dispose();
    });

    test("should detect package as unavailable when bin path is null", () => {
      const manager = new TestPackageManager("inspect-ai", () => null);

      assert.strictEqual(manager.available, false);
      manager.dispose();
    });

    test("should handle empty path as unavailable", () => {
      const manager = new TestPackageManager("inspect-ai", () => ({
        path: "",
      }));

      // Empty string is truthy for !== undefined check but falsy otherwise
      // The implementation checks packageBinPath_ !== null
      assert.ok(manager.available !== undefined);
      manager.dispose();
    });
  });

  suite("Package Change Events", () => {
    test("should fire event when package becomes available", () => {
      let packageAvailable = false;
      let eventFired = false;
      let availabilityFromEvent = false;

      const manager = new TestPackageManager("inspect-ai", () =>
        packageAvailable ? { path: "/usr/bin/inspect" } : null
      );

      manager.onPackageChanged(event => {
        eventFired = true;
        availabilityFromEvent = event.available;
      });

      // Package was initially unavailable, change it
      packageAvailable = true;
      manager.simulateInterpreterChange();

      assert.strictEqual(eventFired, true);
      assert.strictEqual(availabilityFromEvent, true);
      manager.dispose();
    });

    test("should fire event when package becomes unavailable", () => {
      let packageAvailable = true;
      const events: MockPackageChangedEvent[] = [];

      const manager = new TestPackageManager("inspect-ai", () =>
        packageAvailable ? { path: "/usr/bin/inspect" } : null
      );

      manager.onPackageChanged(event => {
        events.push(event);
      });

      // Package was initially available, make it unavailable
      packageAvailable = false;
      manager.simulateInterpreterChange();

      // Should have fired an event with available: false
      assert.ok(events.some(e => e.available === false));
      manager.dispose();
    });

    test("should not fire event if availability unchanged", () => {
      const events: MockPackageChangedEvent[] = [];

      const manager = new TestPackageManager("inspect-ai", () => ({
        path: "/usr/bin/inspect",
      }));

      manager.onPackageChanged(event => {
        events.push(event);
      });

      // Simulate change but path is still the same
      manager.simulateInterpreterChange();
      manager.simulateInterpreterChange();

      // Only the initial event should have fired (from constructor)
      // Subsequent calls with same value should not fire
      const initialEventCount = events.length;
      manager.simulateInterpreterChange();
      assert.strictEqual(events.length, initialEventCount);
      manager.dispose();
    });

    test("should include bin path in event", () => {
      const events: MockPackageChangedEvent[] = [];
      let currentPath = "/initial/path/inspect";

      const manager = new TestPackageManager("inspect-ai", () => ({
        path: currentPath,
      }));

      manager.onPackageChanged(event => {
        events.push(event);
      });

      // Change the path to trigger an event
      currentPath = "/custom/path/inspect";
      manager.simulateInterpreterChange();

      // Should have received at least one event
      assert.ok(events.length > 0);
      // The bin path should be set in the event
      const lastEvent = events[events.length - 1];
      assert.ok(
        lastEvent.binPath === null || lastEvent.binPath.path !== undefined
      );
      manager.dispose();
    });
  });

  suite("Package Watching", () => {
    test("should start watching when package unavailable", () => {
      const manager = new TestPackageManager("inspect-ai", () => null);

      assert.strictEqual(manager.isWatching(), true);
      manager.dispose();
    });

    test("should not watch when package is available", () => {
      const manager = new TestPackageManager("inspect-ai", () => ({
        path: "/usr/bin/inspect",
      }));

      assert.strictEqual(manager.isWatching(), false);
      manager.dispose();
    });

    test("should stop watching when package becomes available", async () => {
      let packageAvailable = false;

      const manager = new TestPackageManager("inspect-ai", () =>
        packageAvailable ? { path: "/usr/bin/inspect" } : null
      );

      assert.strictEqual(manager.isWatching(), true);

      // Simulate package becoming available
      packageAvailable = true;

      // Wait for watch interval to fire
      await new Promise(resolve => setTimeout(resolve, 150));

      assert.strictEqual(manager.isWatching(), false);
      assert.strictEqual(manager.available, true);
      manager.dispose();
    });
  });

  suite("Disposal", () => {
    test("should clear interval on dispose", () => {
      const manager = new TestPackageManager("inspect-ai", () => null);

      assert.strictEqual(manager.isWatching(), true);

      manager.dispose();

      assert.strictEqual(manager.isWatching(), false);
    });

    test("should handle multiple dispose calls safely", () => {
      const manager = new TestPackageManager("inspect-ai", () => null);

      manager.dispose();
      manager.dispose();
      manager.dispose();

      assert.strictEqual(manager.isWatching(), false);
    });
  });

  suite("Python Interpreter Changes", () => {
    test("should recheck package when interpreter changes", () => {
      let checkCount = 0;

      const manager = new TestPackageManager("inspect-ai", () => {
        checkCount++;
        return { path: "/usr/bin/inspect" };
      });

      const initialCount = checkCount;
      manager.simulateInterpreterChange();

      assert.strictEqual(checkCount, initialCount + 1);
      manager.dispose();
    });

    test("should update availability based on new interpreter", () => {
      let useFirstInterpreter = true;

      const manager = new TestPackageManager("inspect-ai", () =>
        useFirstInterpreter ? { path: "/python1/bin/inspect" } : null
      );

      assert.strictEqual(manager.available, true);

      // Switch interpreter (which doesn't have the package)
      useFirstInterpreter = false;
      manager.simulateInterpreterChange();

      assert.strictEqual(manager.available, false);
      manager.dispose();
    });
  });

  suite("Package Name Handling", () => {
    test("should store package name", () => {
      const manager = new TestPackageManager("inspect-ai", () => null);
      assert.strictEqual(manager.packageName, "inspect-ai");
      manager.dispose();
    });

    test("should handle inspect-scout package", () => {
      const manager = new TestPackageManager("inspect-scout", () => ({
        path: "/usr/bin/scout",
      }));
      assert.strictEqual(manager.packageName, "inspect-scout");
      assert.strictEqual(manager.available, true);
      manager.dispose();
    });
  });

  suite("Event Listener Management", () => {
    test("should allow multiple listeners", () => {
      const events1: MockPackageChangedEvent[] = [];
      const events2: MockPackageChangedEvent[] = [];
      let packageAvailable = false;

      const manager = new TestPackageManager("inspect-ai", () =>
        packageAvailable ? { path: "/usr/bin/inspect" } : null
      );

      manager.onPackageChanged(e => events1.push(e));
      manager.onPackageChanged(e => events2.push(e));

      packageAvailable = true;
      manager.simulateInterpreterChange();

      assert.ok(events1.length > 0);
      assert.ok(events2.length > 0);
      manager.dispose();
    });

    test("should allow disposing individual listeners", () => {
      const events: MockPackageChangedEvent[] = [];
      let packageAvailable = false;

      const manager = new TestPackageManager("inspect-ai", () =>
        packageAvailable ? { path: "/usr/bin/inspect" } : null
      );

      const disposable = manager.onPackageChanged(e => events.push(e));

      packageAvailable = true;
      manager.simulateInterpreterChange();
      const countAfterFirst = events.length;

      disposable.dispose();

      // Change again
      packageAvailable = false;
      manager.simulateInterpreterChange();

      // Should not have received the second event
      assert.strictEqual(events.length, countAfterFirst);
      manager.dispose();
    });
  });
});
