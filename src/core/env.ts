import { lstatSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { sep } from "path";

import { Uri } from "vscode";

import { lines } from "./text";

/**
 * Whether the workspace `.env` at `fsPath` is safe to read from or write to: it
 * must be a regular file (not a symlink) whose real path resolves inside
 * `workspaceFsPath`. A repository can ship `.env` as a symlink to a file outside
 * the workspace (git preserves symlinks and the executable/symlink bits), and
 * following it would redirect the extension's env reads and — more seriously —
 * its whole-file rewrites to an arbitrary user file. A `.env` that does not yet
 * exist is safe to create. See CWE-59.
 */
export function envFilePathIsSafe(
  fsPath: string,
  workspaceFsPath: string
): boolean {
  let stat;
  try {
    stat = lstatSync(fsPath);
  } catch (error) {
    // No file or (dangling) symlink present → safe to create a regular file.
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return false;
  }
  try {
    const realFile = realpathSync(fsPath);
    const realRoot = realpathSync(workspaceFsPath);
    const rootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    return realFile.startsWith(rootPrefix);
  } catch {
    return false;
  }
}

export const readEnv = (file: Uri): Record<string, string> => {
  // Read the env file (empty if there is no env file)
  const envLines = readEnvLines(file);
  return envLines
    .map((line) => {
      return readLine(line);
    })
    .reduce(
      (prev, current) => {
        if (current) {
          prev[current.key] = current?.value;
        }
        return prev;
      },
      {} as Record<string, string>
    );
};

export const writeEnv = (key: string, value: string, file: Uri) => {
  // Read the env file
  const envLines = readEnvLines(file);
  const outLines = [];

  let valueWritten = false;
  for (const line of envLines) {
    const parsed = readLine(line);
    if (parsed?.key === key) {
      outLines.push(toLine(key, value));
      valueWritten = true;
    } else {
      outLines.push(line);
    }
  }
  if (!valueWritten) {
    outLines.push(toLine(key, value));
  }

  writeFileSync(file.fsPath, outLines.join("\n"), { encoding: "utf-8" });
};

export const clearEnv = (key: string, file: Uri) => {
  // Read the env file
  const envLines = readEnvLines(file);
  const outLines = [];

  for (const line of envLines) {
    const parsed = readLine(line);
    if (parsed?.key !== key) {
      outLines.push(line);
    }
  }
  writeFileSync(file.fsPath, outLines.join("\n"), { encoding: "utf-8" });
};

function readLine(line: string) {
  const trimmed = line.trim();

  // Comment
  if (trimmed.startsWith("#")) {
    return undefined;
  }

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 0) {
    return undefined;
  }

  const key = trimmed.substring(0, eqIdx).trim();
  let value = trimmed.substring(eqIdx + 1).trim();

  ["'", '"'].forEach((quote) => {
    if (value.startsWith(quote) && value.endsWith(quote)) {
      value = value.substring(quote.length, value.length - quote.length);
    }
  });

  return { key, value };
}

function readEnvLines(file: Uri) {
  // Treat a missing env file as empty rather than checking existence
  // beforehand (the file could appear or disappear in between)
  let envRaw: string;
  try {
    envRaw = readFileSync(file.fsPath, { encoding: "utf-8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return lines(envRaw);
}

function toLine(key: string, value: string) {
  // Strip CR/LF so a value can never smuggle extra `KEY=VALUE` lines into the
  // line-oriented .env file — that would let a hostile webview message create
  // arbitrary env entries past the caller's key whitelist. See CWE-93.
  key = key.replace(/[\r\n]/g, "");
  value = value.replace(/[\r\n]/g, "");

  const needsQuote = [" ", "'", '"'].some((char) => {
    return value.indexOf(char) > -1;
  });

  const quoteChar = !needsQuote ? "" : value.indexOf('"') > -1 ? "'" : '"';
  return `${key}=${quoteChar}${value}${quoteChar}`;
}
