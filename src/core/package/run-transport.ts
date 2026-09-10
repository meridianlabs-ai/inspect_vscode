import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Keep task inputs out of shell syntax, including when startup replaces the
 * shell or VS Code 1.93 cannot report its identity. Only a base64-encoded file
 * path is interpolated into this fixed double-quoted Python program. Its ASCII
 * alphabet has no expansions in sh/bash/zsh, fish, cmd or PowerShell.
 *
 * The activated terminal provides python3 (Unix) / python (Windows). -I keeps
 * the bootstrap from importing modules from the current directory or PYTHONPATH;
 * the child still inherits the activated environment and terminal stdio.
 * The selected interpreter and all task data travel through the private JSON
 * file, avoiding both shell quoting and cmd's command-line length limit.
 */
export function createRunTransport(
  python: readonly string[],
  packageName: string,
  command: string,
  args: readonly string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform
): { commandLine: string; dispose: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "inspect-run-"));
  const file = join(directory, "run.json");
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    writeFileSync(
      file,
      JSON.stringify({ python, packageName, command, args, cwd }),
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );
    const encodedPath = Buffer.from(file, "utf8").toString("base64");
    const readPayload = [
      `p=base64.b64decode('${encodedPath}').decode('utf-8')`,
      "f=open(p,encoding='utf-8')",
      "d=json.load(f)",
      "f.close()",
    ];
    // The child reads task inputs itself: even interpreter wrappers on Windows
    // never receive a filename or parameter as part of their command line.
    const child = [
      "import base64,importlib.metadata,json,os,sys",
      ...readPayload,
      "os.unlink(p)",
      "os.rmdir(os.path.dirname(p))",
      "os.chdir(d['cwd'])",
      "sys.argv=[d['command']]+d['args']",
      "entry=next(e for e in importlib.metadata.distribution(d['packageName']).entry_points if e.group=='console_scripts' and e.name==d['command'])",
      "sys.exit(entry.load()())",
    ].join(";");
    const encodedChild = Buffer.from(child, "utf8").toString("base64");
    const script = [
      "import base64,json,subprocess,sys",
      ...readPayload,
      // Like a console script, do not put the shell's current directory on
      // the child's import path. Keep explicit PYTHONPATH and environment setup.
      // chr(39) avoids nesting shell-visible double quotes or backslashes.
      `c='import sys;sys.path[:]=[p for p in sys.path if p];import base64;exec(base64.b64decode('+chr(39)+'${encodedChild}'+chr(39)+'))'`,
      "sys.exit(subprocess.call(d['python']+['-c',c]))",
    ].join(";");
    const bootstrap = platform === "win32" ? "python" : "python3";
    return { commandLine: `${bootstrap} -I -c "${script}"`, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
