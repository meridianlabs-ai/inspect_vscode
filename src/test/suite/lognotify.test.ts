import * as assert from "assert";

import { Uri } from "vscode";

import { taskNameFromLog } from "../../providers/lognotify";

suite("LogNotify Test Suite", () => {
  suite("taskNameFromLog", () => {
    test("extracts the task name from a standard log filename", () => {
      const uri = Uri.file(
        "/logs/2024-01-01T12-00-00+00-00_my-task_abcd1234.eval"
      );
      assert.strictEqual(taskNameFromLog(uri), "my-task");
    });

    test("works for a nested posix path", () => {
      const uri = Uri.file(
        "/home/user/project/logs/2024-01-01T12-00-00+00-00_eval-task_x.eval"
      );
      assert.strictEqual(taskNameFromLog(uri), "eval-task");
    });

    test("handles a Windows-style file path", () => {
      // The fragile split("/") approach failed on backslash-separated paths;
      // basename() resolves the filename correctly regardless of separator.
      const uri = Uri.file(
        "C:\\Users\\me\\logs\\2024-01-01T12-00-00+00-00_win-task_y.eval"
      );
      assert.strictEqual(taskNameFromLog(uri), "win-task");
    });

    test("falls back to 'task' when there is no task segment", () => {
      const uri = Uri.file("/logs/singletoken.eval");
      assert.strictEqual(taskNameFromLog(uri), "task");
    });

    test("works for a remote (non-file) log URI", () => {
      const uri = Uri.parse(
        "s3://bucket/logs/2024-01-01T12-00-00+00-00_remote-task_z.eval"
      );
      assert.strictEqual(taskNameFromLog(uri), "remote-task");
    });
  });
});
