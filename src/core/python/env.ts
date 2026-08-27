import * as fs from "fs";
import { existsSync } from "node:fs";
import * as os from "os";
import path, { join } from "path";

import { AbsolutePath, toAbsolutePath } from "../path";

export function findEnvPythonPath(
  startDir: AbsolutePath,
  baseDir: AbsolutePath
): AbsolutePath | null {
  let currentDir = startDir;
  while (currentDir.path !== baseDir.path) {
    // Look for a python environment
    const pythonPath = findEnvPython(currentDir);
    if (pythonPath) {
      return toAbsolutePath(pythonPath);
    }

    // Move to the parent directory. The exact-equality exit above is only
    // reached when startDir is a descendant of baseDir; for an out-of-tree start
    // point (a second multi-root folder, a loose file, or a drive-letter case
    // mismatch on Windows) the walk would otherwise descend to the filesystem
    // root, where dirname() is a fixed point ('/' -> '/', 'C:\' -> 'C:\'), and
    // spin forever on a synchronous readdir/stat loop that freezes the extension
    // host. Stop as soon as the parent stops changing.
    const parent = currentDir.dirname();
    if (parent.path === currentDir.path) {
      return null;
    }
    currentDir = parent;
  }

  // No Python environment found
  return null;
}

// Helper function to search for Python environment in a given directory
function findEnvPython(directory: AbsolutePath): string | null {
  const items = fs.readdirSync(directory.path);

  // Filter only directories and check if any is an environment directory
  const envDir = items
    .map((item) => path.join(directory.path, item))
    .filter((filePath) => fs.statSync(filePath).isDirectory())
    .find(isEnvDir);

  if (envDir) {
    return getPythonPath(envDir);
  }

  return null;
}

function getPythonPath(dir: string): string | null {
  const pythonSuffixes =
    os.platform() === "win32"
      ? ["Scripts/python.exe", "python.exe"]
      : ["bin/python3", "bin/python"];
  for (const suffix of pythonSuffixes) {
    const fullPath = path.join(dir, suffix);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function isEnvDir(dir: string) {
  return (
    existsSync(join(dir, "pyvenv.cfg")) || existsSync(join(dir, "conda-meta"))
  );
}
