import { Uri } from "vscode";

import { isUncPath } from "../../core/uri";
import { isTrustedLogLocation } from "../protocol-handler";

import type { SandboxOperation } from "./command-sandbox";

export type CommandOperation = Uri | SandboxOperation;

export const kMaxCommands = 16;
export class CommandRequestError extends Error {}

interface RequestContext {
  trustedRoots?: readonly Uri[];
  platform?: NodeJS.Platform;
}

/** An unauthenticated writer has only the authority of this fixed operation. */
export function parseCommandRequest(
  value: unknown,
  context: RequestContext = {}
): CommandOperation[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > kMaxCommands
  ) {
    throw new CommandRequestError("Expected a batch of 1–16 log requests.");
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new CommandRequestError("Invalid command entry.");
    }
    const request = entry as Record<string, unknown>;
    if (
      request.command === "inspect.openSandboxTerminal" ||
      request.command === "inspect.attachSandbox"
    ) {
      const args = request.args;
      const terminal = request.command === "inspect.openSandboxTerminal";
      if (
        Object.keys(request).length !== 2 ||
        !Array.isArray(args) ||
        args.length !== 1 ||
        typeof args[0] !== "object" ||
        args[0] === null ||
        Array.isArray(args[0])
      ) {
        throw new CommandRequestError("Invalid sandbox request.");
      }
      const payload = args[0] as Record<string, unknown>;
      if (
        Object.keys(payload).some(
          (key) => key !== "container" && !(terminal && key === "user")
        ) ||
        typeof payload.container !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(payload.container) ||
        ("user" in payload &&
          (typeof payload.user !== "string" ||
            !/^(?:[a-z_][a-z0-9_-]{0,31}|[0-9]{1,10})(?::(?:[a-z_][a-z0-9_-]{0,31}|[0-9]{1,10}))?$/i.test(
              payload.user
            )))
      ) {
        throw new CommandRequestError("Invalid sandbox target or user.");
      }
      return {
        kind: terminal ? "terminal" : "attach",
        container: payload.container,
        ...(typeof payload.user === "string" ? { user: payload.user } : {}),
      };
    }
    if (
      Object.keys(request).length !== 2 ||
      request.command !== "inspect.openLogViewer" ||
      !Array.isArray(request.args) ||
      request.args.length !== 1 ||
      typeof request.args[0] !== "string"
    ) {
      throw new CommandRequestError(
        "Unsupported command or arguments. Use inspect.openLogViewer, inspect.openSandboxTerminal or inspect.attachSandbox with their typed arguments. Older sandbox links require an updated Python producer; use its displayed connection instructions or the command palette."
      );
    }
    let target = request.args[0];
    if (target.length > 8192 || hasControls(target)) {
      throw new CommandRequestError("Invalid log location.");
    }
    // Older Python to_uri versions return drive paths or encode the drive and
    // backslashes into file://authority. Normalize only unambiguous local drives.
    if ((context.platform ?? process.platform) === "win32") {
      if (/^[a-z]:[\\/]/i.test(target)) {
        const [, path, suffix = ""] = /^([^?#]+)(.*)$/.exec(target)!;
        target =
          Uri.from({
            scheme: "file",
            path: "/" + path!.replace(/\\/g, "/"),
          }).toString() + suffix;
      }
      const legacy = /^file:\/\/([^/?#]+)(.*)$/.exec(target);
      if (legacy) {
        const drive = decodeURIComponent(legacy[1]!);
        if (/^[a-z]:\\/i.test(drive)) {
          target =
            Uri.from({
              scheme: "file",
              path: "/" + drive.replace(/\\/g, "/"),
            }).toString() + legacy[2]!;
        }
      }
    }
    if (!/^(file|https?|s3|gs|gcs|az|abfs|abfss):\/\//.test(target)) {
      throw new CommandRequestError("Unsupported log location.");
    }
    const uri = Uri.parse(target, true);
    if (
      hasControls(uri.path + uri.authority + uri.query) ||
      (uri.path + uri.authority).includes("\\") ||
      uri.fragment ||
      !uri.path.startsWith("/") ||
      !/\.(eval|json)$/i.test(uri.path) ||
      (uri.scheme !== "file" && (!uri.authority || !validAuthority(uri))) ||
      (uri.scheme === "file" &&
        (uri.authority || isUncPath(uri.fsPath)) &&
        !isTrustedLogLocation(uri, context.trustedRoots ?? []))
    ) {
      throw new CommandRequestError(
        "Invalid log URI or untrusted network file location."
      );
    }
    // Uri.parse decodes the whole query, which can turn an encoded ampersand
    // inside a sample ID into a separator. Parse the wire query exactly once.
    const queryStart = target.indexOf("?");
    const params = new URLSearchParams(
      queryStart < 0 ? "" : target.slice(queryStart + 1)
    );
    const keys = [...params.keys()];
    const epoch = params.get("epoch");
    if (
      keys.some((key) => key !== "sample_id" && key !== "epoch") ||
      [...params.values()].some(hasControls) ||
      new Set(keys).size !== keys.length ||
      (epoch !== null &&
        (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch))))
    ) {
      throw new CommandRequestError(
        "Invalid or duplicate log query parameter."
      );
    }
    // Sample IDs are opaque text. logview-panel uses jsonForScript rather than
    // interpolating them into executable HTML, including on the legacy viewer.
    return uri.with({ query: params.toString() });
  });
}

export interface CommandRequestActions {
  trustedRoots?: () => readonly Uri[];
  confirmRemote?: (targets: readonly Uri[]) => Promise<boolean>;
  prepareSandbox?: (
    operation: SandboxOperation
  ) => Promise<(() => Promise<void>) | undefined>;
  openLog: (target: Uri) => Promise<void>;
}

export async function handleCommandRequest(
  value: unknown,
  actions: CommandRequestActions
): Promise<void> {
  const trustedRoots = actions.trustedRoots?.() ?? [];
  const targets = parseCommandRequest(value, { trustedRoots });
  // Unconfigured remote targets can fetch with ambient credentials. Normal
  // local logs and explicitly configured remote roots require no confirmation.
  const remote = targets.filter(
    (uri): uri is Uri =>
      uri instanceof Uri &&
      uri.scheme !== "file" &&
      !isTrustedLogLocation(uri, trustedRoots)
  );
  if (remote.length && !(await actions.confirmRemote?.(remote))) return;
  const effects: (() => Promise<void>)[] = [];
  for (const target of targets) {
    if (target instanceof Uri) effects.push(() => actions.openLog(target));
    else {
      const effect = await actions.prepareSandbox?.(target);
      if (!effect) return;
      effects.push(effect);
    }
  }
  for (const effect of effects) await effect();
}

function hasControls(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  );
}

function validAuthority(uri: Uri): boolean {
  // Azure ABFS identifies the filesystem as container@account, not HTTP userinfo.
  if (
    (uri.scheme === "abfs" || uri.scheme === "abfss") &&
    uri.authority.includes("@")
  ) {
    return /^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9.-]*$/i.test(uri.authority);
  }
  return /^[A-Za-z0-9._~:[\]-]+$/.test(uri.authority);
}
