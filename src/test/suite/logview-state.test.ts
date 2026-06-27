import * as assert from "assert";

import { Uri } from "vscode";

import { viewPathScopesEqual } from "../../core/uri";
import {
  logFileIsInLogviewScope,
  logviewPathScope,
  LogviewState,
} from "../../providers/logview/logview-state";

suite("Logview State Test Suite", () => {
  const logDir = Uri.file("/logs");
  const firstLog = Uri.file("/logs/first.eval");
  const secondLog = Uri.file("/logs/second.eval");

  test("changes scope between directory and exact-file views", () => {
    const directoryState: LogviewState = {
      log_dir: logDir,
      scope_kind: "directory",
    };
    const firstFileState: LogviewState = {
      log_dir: logDir,
      log_file: firstLog,
      scope_kind: "file",
    };
    const secondFileState: LogviewState = {
      log_dir: logDir,
      log_file: secondLog,
      scope_kind: "file",
    };

    assert.strictEqual(
      viewPathScopesEqual(
        logviewPathScope(directoryState),
        logviewPathScope(firstFileState)
      ),
      false
    );
    assert.strictEqual(
      viewPathScopesEqual(
        logviewPathScope(firstFileState),
        logviewPathScope(secondFileState)
      ),
      false
    );
  });

  test("directory views accept child log updates", async () => {
    const state: LogviewState = {
      log_dir: logDir,
      scope_kind: "directory",
    };
    const scope = logviewPathScope(state);

    assert.strictEqual(await logFileIsInLogviewScope(scope, firstLog), true);
    assert.strictEqual(
      await logFileIsInLogviewScope(scope, Uri.file("/other/first.eval")),
      false
    );
  });

  test("file views accept updates only for the selected file", async () => {
    const state: LogviewState = {
      log_dir: logDir,
      log_file: firstLog,
      scope_kind: "file",
    };
    const scope = logviewPathScope(state);

    assert.strictEqual(await logFileIsInLogviewScope(scope, firstLog), true);
    assert.strictEqual(await logFileIsInLogviewScope(scope, secondLog), false);
  });
});
