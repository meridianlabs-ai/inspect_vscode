import { Uri } from "vscode";

import { validateLogUri } from "../protocol-handler";

export const kMaxCommands = 16;

/** The file channel is untrusted, including when its writer is the same OS user. */
export function parseCommandRequest(value: unknown): Uri[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > kMaxCommands
  ) {
    throw new Error("Expected a batch of 1–16 log requests.");
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Invalid command entry.");
    }
    const request = entry as Record<string, unknown>;
    if (
      Object.keys(request).length !== 2 ||
      request.command !== "inspect.openLogViewer" ||
      !Array.isArray(request.args) ||
      request.args.length !== 1 ||
      typeof request.args[0] !== "string"
    ) {
      throw new Error(
        "Only inspect.openLogViewer with one log URI is supported. Use the VS Code command palette for other actions, including attaching to containers."
      );
    }
    const target = request.args[0];
    if (target.length > 8192 || !/^(file|https?|s3):\/\//.test(target)) {
      throw new Error("Invalid log location.");
    }
    const uri = Uri.parse(target, true);
    // Do not allow decoded control characters, backslashes, fragments, or
    // arbitrary query fields to change how downstream consumers interpret it.
    if (
      hasControls(uri.path + uri.authority + uri.query) ||
      (uri.path + uri.authority).includes("\\") ||
      uri.fragment ||
      !uri.path.startsWith("/") ||
      (uri.scheme !== "file" && !uri.authority) ||
      validateLogUri(uri) !== null
    ) {
      throw new Error("Invalid log URI or sample selection.");
    }
    const params = new URLSearchParams(uri.query);
    const keys = [...params.keys()];
    if (
      keys.some((key) => key !== "sample_id" && key !== "epoch") ||
      [...params.values()].some(hasControls) ||
      new Set(keys).size !== keys.length
    ) {
      throw new Error("Unsupported or duplicate log query parameter.");
    }
    return uri;
  });
}

export interface CommandRequestActions {
  confirm: (targets: readonly Uri[]) => Promise<boolean>;
  openLog: (target: Uri) => Promise<void>;
}

export async function handleCommandRequest(
  value: unknown,
  actions: CommandRequestActions
): Promise<void> {
  // Validate the entire batch before prompting or opening any of its entries.
  const targets = parseCommandRequest(value);
  if (await actions.confirm(targets)) {
    for (const target of targets) {
      await actions.openLog(target);
    }
  }
}

function hasControls(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  );
}
