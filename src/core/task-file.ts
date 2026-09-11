import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

import { isValidPythonFnName } from "./python/code";

/** Normalize once for both the existence check and exclusive creation. */
export function taskFileName(input: string): string {
  const name = input.toLowerCase();
  if (!isValidPythonFnName(name))
    throw new Error("The task name contains invalid characters.");
  return `${name}.py`;
}

/** Includes dangling symlinks, directories, and files with user edits. */
export function taskFileExists(root: string, input: string): boolean {
  return (
    lstatSync(join(root, taskFileName(input)), { throwIfNoEntry: false }) !==
    undefined
  );
}

/** root is the canonical workspace directory captured before the input dialog.
 * The target has exactly one path component; no repository-controlled ancestor
 * is traversed. Exclusive creation refuses a link/file arriving after validation.
 */
export function createTaskFile(
  root: string,
  input: string,
  content: string
): string {
  if (realpathSync(root) !== root)
    throw new Error("The selected workspace location changed.");
  const target = join(root, taskFileName(input));
  if (taskFileExists(root, input))
    throw new Error(`A task file already exists: ${target}`);
  const fd = openSync(target, "wx");
  try {
    const opened = fstatSync(fd);
    const entry = lstatSync(target);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.dev !== opened.dev ||
      entry.ino !== opened.ino ||
      dirname(realpathSync(target)) !== root
    ) {
      throw new Error("The task file location changed during creation.");
    }
    writeFileSync(fd, content, { encoding: "utf-8" });
  } finally {
    closeSync(fd);
  }
  return target;
}
