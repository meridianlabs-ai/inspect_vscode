import { readFileSync, writeFileSync } from "fs";

import { Uri } from "vscode";

import { lines } from "./text";

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
  const needsQuote = [" ", "'", '"'].some((char) => {
    return value.indexOf(char) > -1;
  });

  const quoteChar = !needsQuote ? "" : value.indexOf('"') > -1 ? "'" : '"';
  return `${key}=${quoteChar}${value}${quoteChar}`;
}
