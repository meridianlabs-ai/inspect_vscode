// The kind of shell a command line will be sent to. We send run commands to a
// VS Code integrated terminal via `terminal.sendText`, so the string must be
// escaped according to the shell that terminal is actually running.
export type ShellKind = "posix" | "fish" | "powershell" | "cmd";

/**
 * Identify a {@link ShellKind} from a shell executable path or from one of the
 * shell type identifiers VS Code reports through `terminal.state.shell`
 * (`bash`, `gitbash`, `pwsh`, `cmd`, …). Returns `undefined` when the value is
 * empty or unrecognized so the caller can fall through to its next signal.
 */
export function shellKindFromPath(
  shellPath: string | undefined
): ShellKind | undefined {
  const name = (shellPath ?? "").toLowerCase();
  if (!name) {
    return undefined;
  }
  if (
    /(^|[\\/])(bash|gitbash|zsh|sh|dash|ksh|csh|tcsh|wsl)(\.exe)?$/.test(name)
  ) {
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
      // characters (they appear in file names typed on macOS), so an embedded
      // smart quote would otherwise terminate the string — double those too.
      return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;
    case "cmd":
      // Inside double quotes cmd.exe keeps `& | < > ( ) ^` literal, so a task
      // at "tasks (1)/demo.py" arrives intact. A caret is *not* an escape
      // character inside quotes and would be handed to the program, so it
      // must not be added. Embedded double quotes are doubled, which the
      // program's C runtime reads back as one quote.
      return `"${value.replace(/"/g, '""')}"`;
  }
}

/**
 * Quotes each part for the given shell where necessary and joins them into a
 * command line string. PowerShell parses a quoted first token as a string
 * expression rather than a command, so a program path that needs quoting (one
 * with spaces, the common case under `C:\Users\First Last`) is invoked through
 * the call operator: `& 'C:\...\inspect.exe' eval ...`.
 */
export function quoteCommandLine(parts: string[], kind: ShellKind): string {
  const quoted = parts.map((part) => quoteArg(part, kind));
  if (kind === "powershell" && quoted.length > 0 && quoted[0] !== parts[0]) {
    quoted[0] = `& ${quoted[0]}`;
  }
  return quoted.join(" ");
}

/**
 * The command that moves a reused terminal back to `cwd`. cmd.exe needs `/d`
 * to follow a directory on another drive; PowerShell's `cd` (Set-Location)
 * expands wildcards such as `[` unless the path is given literally.
 */
export function changeDirectoryCommand(cwd: string, kind: ShellKind): string {
  switch (kind) {
    case "cmd":
      return `cd /d ${quoteArg(cwd, kind)}`;
    case "powershell":
      return `cd -LiteralPath ${quoteArg(cwd, kind)}`;
    default:
      return `cd ${quoteArg(cwd, kind)}`;
  }
}
