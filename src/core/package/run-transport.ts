import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

/**
 * Run a selected Python execution vector from the activated integrated
 * terminal without letting the terminal's shell search for an executable and
 * without serializing task inputs into shell syntax.
 *
 * The shell only ever sees a fixed operating-system program at an absolute
 * path plus an ASCII program for that launcher:
 *
 * - Unix: `/bin/sh -c '<POSIX sh program>'`. Inside single quotes sh, bash,
 *   zsh, fish and PowerShell interpret nothing but a closing quote, which the
 *   program never contains. Every byte of the interpreter, launcher and payload
 *   paths outside [A-Za-z0-9/._] is emitted as a printf octal escape and
 *   decoded by sh's printf builtin, so hostile installation paths never become
 *   sh syntax either. sh then execs the selected interpreter directly.
 * - Windows: `<SystemRoot>/System32/WindowsPowerShell/v1.0/powershell.exe
 *   -EncodedCommand <base64>`. The base64 alphabet has no meaning in cmd,
 *   PowerShell or Git Bash. The decoded Windows PowerShell program starts the
 *   selected interpreter through System.Diagnostics.Process with a literal
 *   file name and a CRT-quoted argument string, bypassing PowerShell command
 *   discovery and native argument re-quoting.
 *
 * The selected interpreter runs a private launcher script from a fresh
 * mkdtemp directory, so its sys.path[0] is that private directory rather than
 * the shell's current directory, while PYTHONPATH and the rest of the
 * activated terminal environment are inherited. Task inputs, cwd and the
 * console entry point travel in a private JSON payload next to the launcher.
 * The launcher consumes both files before changing directory and dispatching.
 */
export function createRunTransport(
  python: readonly string[],
  packageName: string,
  command: string,
  args: readonly string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env.SystemRoot ?? process.env.windir
): { commandLine: string; dispose: () => void } {
  const program = python[0];
  const paths = platform === "win32" ? win32 : posix;
  if (!program || !paths.isAbsolute(program)) {
    throw new Error(
      "The Python launch vector must start with an absolute interpreter path."
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "inspect-run-"));
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    const launcher = join(directory, "inspect_run_launcher.py");
    const payload = join(directory, "run.json");
    writeFileSync(launcher, kLauncherSource, { encoding: "utf8", mode: 0o600 });
    writeFileSync(
      payload,
      JSON.stringify({ packageName, command, args, cwd }),
      { encoding: "utf8", mode: 0o600 }
    );
    const argv = [...python, launcher, payload];
    const commandLine =
      platform === "win32"
        ? windowsCommandLine(argv, systemRoot)
        : unixCommandLine(argv, platform);
    return { commandLine, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

/**
 * Resolve the first element of an execution vector to an absolute path
 * without ever consulting the terminal's or the extension host's current
 * directory. A bare name (for example the Python extension's default
 * `python` when no interpreter is selected) is looked up on the extension
 * host PATH only; a relative path is anchored at the workspace.
 */
export function resolveLaunchVector(
  python: readonly string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const [program, ...rest] = python;
  if (!program) {
    throw new Error("No active Python interpreter available.");
  }
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  if (paths.isAbsolute(program)) {
    return [program, ...rest];
  }
  if (/[\\/]/.test(program)) {
    return [paths.resolve(cwd, program), ...rest];
  }
  const extensions =
    windows && !/\.[^.\\/]+$/.test(program)
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const dir of (env.PATH ?? "").split(paths.delimiter)) {
    // Empty or relative PATH entries resolve against the current directory;
    // never treat them as a trusted location.
    if (!dir || !paths.isAbsolute(dir)) {
      continue;
    }
    for (const extension of ["", ...extensions]) {
      // The file system is the host's, whatever platform semantics apply to
      // the vector itself.
      const candidate = join(dir, program + extension);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return [candidate, ...rest];
      }
    }
  }
  throw new Error(
    `The selected Python interpreter "${program}" was not found on PATH. ` +
      "Select an interpreter with the Python extension and try again."
  );
}

// Executed by the selected interpreter as a script, so sys.path[0] is the
// private launcher directory rather than the terminal's current directory.
const kLauncherSource = [
  "import importlib.metadata, json, os, sys",
  "payload = sys.argv[1]",
  "with open(payload, encoding='utf-8') as f:",
  "    d = json.load(f)",
  "# Consume the private files before running anything from the payload.",
  "os.unlink(payload)",
  "os.unlink(__file__)",
  "os.rmdir(os.path.dirname(os.path.abspath(__file__)))",
  "os.chdir(d['cwd'])",
  "sys.argv = [d['command']] + d['args']",
  "entry = next(",
  "    e",
  "    for e in importlib.metadata.distribution(d['packageName']).entry_points",
  "    if e.group == 'console_scripts' and e.name == d['command']",
  ")",
  "sys.exit(entry.load()())",
  "",
].join("\n");

const kUnixShell = "/bin/sh";

/** printf(1) format that reproduces `value` byte for byte, using only ASCII. */
export function printfOctal(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9/._]/.test(char)
      ? char
      : "\\" + byte.toString(8).padStart(3, "0");
  }
  return out;
}

function unixCommandLine(
  argv: readonly string[],
  platform: NodeJS.Platform
): string {
  if (platform === process.platform && !existsSync(kUnixShell)) {
    throw new Error(`${kUnixShell} is required to run tasks.`);
  }
  // A trailing "x" survives $(...)'s newline stripping and is removed by ${v%x}.
  const assignments = argv.map(
    (value, index) => `a${index}=$(printf "${printfOctal(value)}x")`
  );
  const words = argv.map((_, index) => `"\${a${index}%x}"`);
  const program = `${assignments.join(";")};exec ${words.join(" ")}`;
  if (!/^[\x20-\x7e]*$/.test(program) || program.includes("'")) {
    throw new Error("Unexpected character in sh launcher program.");
  }
  return `${kUnixShell} -c '${program}'`;
}

/** Windows CRT command-line quoting, matching Python's subprocess.list2cmdline. */
export function crtQuote(arg: string): string {
  if (arg && !/[ \t]/.test(arg)) {
    return arg.replace(/(\\*)"/g, '$1$1\\"');
  }
  let out = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes++;
      continue;
    }
    if (char === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(backslashes) + char;
    }
    backslashes = 0;
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

function powershellString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function windowsCommandLine(
  argv: readonly string[],
  systemRoot: string | undefined
): string {
  // The launcher path is the only text the terminal shell resolves. Windows
  // itself is installed at an ASCII path; refuse anything the shells could
  // interpret rather than fall back to a PATH search.
  const root = (systemRoot ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!/^[A-Za-z]:(\/[A-Za-z0-9_.-]+)+$/.test(root)) {
    throw new Error(
      `Cannot locate Windows PowerShell: unsupported SystemRoot "${systemRoot}".`
    );
  }
  const powershell = `${root}/System32/WindowsPowerShell/v1.0/powershell.exe`;
  const [program, ...rest] = argv as [string, ...string[]];
  let fileName = program;
  let argumentString = rest.map(crtQuote).join(" ");
  // CreateProcess runs batch files through an implicit `cmd /c` whose quote
  // handling breaks a quoted path with spaces. Start such wrappers through
  // cmd.exe explicitly: /s strips exactly the outer quotes, /v:off keeps `!`
  // literal, and cmd, like Windows PowerShell, lives under SystemRoot.
  if (/\.(cmd|bat)$/i.test(program)) {
    fileName = `${root.replace(/\//g, "\\")}\\System32\\cmd.exe`;
    argumentString = `/d /v:off /s /c "${[program, ...rest]
      .map(crtQuote)
      .join(" ")}"`;
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$i=New-Object System.Diagnostics.ProcessStartInfo",
    `$i.FileName=${powershellString(fileName)}`,
    `$i.Arguments=${powershellString(argumentString)}`,
    "$i.UseShellExecute=$false",
    "try{$p=[System.Diagnostics.Process]::Start($i)}catch{[Console]::Error.WriteLine('Inspect: could not start '+$i.FileName+': '+$_.Exception.Message);exit 1}",
    "$p.WaitForExit()",
    "exit $p.ExitCode",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `${powershell} -NoLogo -NoProfile -NonInteractive -EncodedCommand "${encoded}"`;
}
