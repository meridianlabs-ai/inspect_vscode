// The kind of shell a command line will be sent to. We send run commands to a
// VS Code integrated terminal via `terminal.sendText`, so the string must be
// escaped according to the shell that terminal is actually running.
export type ShellKind = "posix" | "fish" | "powershell" | "cmd";

/**
 * Positively identify a {@link ShellKind} from a shell executable path, or
 * `undefined` when the path is empty or unrecognized. This never guesses a
 * platform default — the caller can
 * distinguish "known to be X" from "could not determine", which matters because
 * quoting for the wrong shell (PowerShell single quotes are inert in cmd.exe,
 * letting an embedded `&` execute) is a command-injection vector.
 */
export function shellKindFromPath(
  shellPath: string | undefined
): ShellKind | undefined {
  const name = (shellPath ?? "").toLowerCase();
  if (!name) {
    return undefined;
  }
  if (/(^|[\\/])(bash|zsh|sh|dash|ksh)(\.exe)?$/.test(name)) {
    return "posix";
  }
  if (/(^|[\\/])fish(\.exe)?$/.test(name)) {
    return "fish";
  }
  if (/(^|[\\/])(pwsh|powershell)(\.exe)?$/.test(name)) {
    return "powershell";
  }
  if (/(^|[\\/])cmd(\.exe)?$/.test(name)) {
    return "cmd";
  }
  return undefined;
}

// Characters that are safe to pass unquoted in any of our supported shells.
// Anything outside this set — spaces, quotes, semicolons, $, backticks, etc.
// — requires quoting. An empty string also requires quoting so it isn't lost.
const kSafePattern = /^[A-Za-z0-9._/@:+,=-]+$/;

/**
 * Whether a token can be passed unquoted to the given shell.
 *
 * `kSafePattern` is a lowest-common-denominator set, but a couple of its
 * members are only inert in POSIX/cmd: in PowerShell argument mode a `,`
 * is the array operator (so `a,b` is split into multiple native-command
 * arguments) and a leading `@` begins splatting / an array subexpression.
 * Such tokens must therefore be quoted for PowerShell even though they match
 * `kSafePattern`.
 */
function isSafeUnquoted(value: string, kind: ShellKind): boolean {
  if (!kSafePattern.test(value)) {
    return false;
  }
  if (kind === "powershell" && (value.includes(",") || value.startsWith("@"))) {
    return false;
  }
  return true;
}

/**
 * Quotes a single argument if it contains characters the target shell would
 * interpret. Safe tokens (alphanumeric + common punctuation) are returned
 * as-is; everything else is wrapped in the shell's appropriate quoting.
 */
export function quoteArg(value: string, kind: ShellKind): string {
  if (isSafeUnquoted(value, kind)) {
    return value;
  }
  switch (kind) {
    case "fish":
      // Fish interprets both backslash and quote escapes inside single quotes.
      // Escape both together so a backslash cannot change the quote boundary.
      return `'${value.replace(/[\\']/g, "\\$&")}'`;
    case "posix":
      // Single quotes suppress all interpretation in POSIX shells. The only
      // character that can't appear literally inside single quotes is the
      // single quote itself, handled by closing, emitting an escaped quote,
      // and reopening: ' -> '\''.
      return `'${value.replace(/'/g, "'\\''")}'`;
    case "powershell":
      // Single-quoted PowerShell strings are literal; an embedded single quote
      // is escaped by doubling it. PowerShell's tokenizer also treats the
      // Unicode single-quotation marks U+2018–U+201B as single-quote
      // characters, so an embedded smart quote would otherwise terminate the
      // string and let the following text execute — double those too.
      return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;
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
