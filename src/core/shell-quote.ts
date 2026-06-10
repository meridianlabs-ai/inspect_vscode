import * as os from "os";

// The kind of shell a command line will be sent to. We send run commands to a
// VS Code integrated terminal via `terminal.sendText`, so the string must be
// escaped according to the shell that terminal is actually running.
export type ShellKind = "posix" | "powershell" | "cmd";

/**
 * Maps a shell executable path to a {@link ShellKind}.
 *
 * When the shell is unknown (no path, or unrecognized), fall back to the
 * platform default: `cmd`/`powershell` on Windows, `posix` elsewhere. We pick
 * `powershell` on Windows because that is VS Code's modern default terminal
 * profile.
 */
export function detectShellKind(shellPath: string | undefined): ShellKind {
  const name = (shellPath ?? "").toLowerCase();

  if (/(^|[\\/])(bash|zsh|sh|fish|dash|ksh)(\.exe)?$/.test(name)) {
    return "posix";
  }
  if (/(^|[\\/])(pwsh|powershell)(\.exe)?$/.test(name)) {
    return "powershell";
  }
  if (/(^|[\\/])cmd(\.exe)?$/.test(name)) {
    return "cmd";
  }

  return os.platform() === "win32" ? "powershell" : "posix";
}

// Characters that are safe to pass unquoted in any of our supported shells.
// Anything outside this set — spaces, quotes, semicolons, $, backticks, etc.
// — requires quoting. An empty string also requires quoting so it isn't lost.
const kSafePattern = /^[A-Za-z0-9._/@:+,=-]+$/;

/**
 * Quotes a single argument if it contains characters the target shell would
 * interpret. Safe tokens (alphanumeric + common punctuation) are returned
 * as-is; everything else is wrapped in the shell's appropriate quoting.
 */
export function quoteArg(value: string, kind: ShellKind): string {
  if (kSafePattern.test(value)) {
    return value;
  }
  switch (kind) {
    case "posix":
      // Single quotes suppress all interpretation in POSIX shells. The only
      // character that can't appear literally inside single quotes is the
      // single quote itself, handled by closing, emitting an escaped quote,
      // and reopening: ' -> '\''.
      return `'${value.replace(/'/g, "'\\''")}'`;
    case "powershell":
      // Single-quoted PowerShell strings are literal; an embedded single quote
      // is escaped by doubling it.
      return `'${value.replace(/'/g, "''")}'`;
    case "cmd": {
      // cmd.exe has no robust quoting, but double quotes plus caret-escaping
      // the command separators closes the common injection vectors. Embedded
      // double quotes are doubled.
      const escaped = value.replace(/"/g, '""').replace(/([&|<>()^])/g, "^$1");
      return `"${escaped}"`;
    }
  }
}

/**
 * Quotes each part for the given shell where necessary and joins them into a
 * command line string.
 */
export function quoteCommandLine(parts: string[], kind: ShellKind): string {
  return parts.map((part) => quoteArg(part, kind)).join(" ");
}
