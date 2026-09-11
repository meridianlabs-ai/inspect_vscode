import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { commands, window } from "vscode";

import { CommandRequestError } from "./command-request";

export interface SandboxOperation {
  kind: "terminal" | "attach";
  container: string;
  user?: string;
}
export interface RunningContainer {
  id: string;
  name: string;
}

/** Only the Docker daemon's current inventory, never a list supplied in a file. */
export function parseContainerInventory(output: string): RunningContainer[] {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length > 512) throw new Error("Too many running containers.");
  return lines.map((line) => {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (
      typeof row.ID !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.ID) ||
      typeof row.Names !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(row.Names)
    ) {
      throw new Error("Unexpected Docker inventory.");
    }
    return { id: row.ID, name: row.Names };
  });
}

export function sandboxTerminalArgs(id: string, user?: string): string[] {
  return ["exec", "-it", ...(user ? ["--user", user] : []), id, "bash", "-l"];
}

interface SandboxHost {
  inventory(): Promise<RunningContainer[]>;
  choose(
    container: RunningContainer,
    operation: SandboxOperation
  ): Promise<boolean>;
  terminal(id: string, user?: string): Promise<void>;
  attach(id: string): Promise<void>;
}
const exec = promisify(execFile);
const host: SandboxHost = {
  inventory: async () => {
    const { stdout } = await exec(
      "docker",
      ["ps", "--no-trunc", "--format", "{{json .}}"],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      }
    );
    return parseContainerInventory(stdout);
  },
  choose: async (container, operation) => {
    const item = {
      label: container.name,
      description: container.id,
      detail:
        operation.kind === "terminal"
          ? `Open bash as ${operation.user ?? "the container's configured user"}`
          : "Attach using Dev Containers (may install its server in the container)",
    };
    return (
      (await window.showQuickPick([item], {
        title: "Inspect sandbox request: verify the Docker target",
        placeHolder:
          "Select the running container to allow this operation; Escape cancels",
        ignoreFocusOut: true,
      })) === item
    );
  },
  terminal: (id, user) => {
    const terminal = window.createTerminal({
      name: "Inspect sandbox",
      shellPath: "docker",
      shellArgs: sandboxTerminalArgs(id, user),
    });
    terminal.show();
    return Promise.resolve();
  },
  attach: async (id) => {
    await commands.executeCommand(
      "remote-containers.attachToRunningContainer",
      id
    );
  },
};

/** The user selects a daemon-verified target; names alone never grant authority. */
export async function prepareSandboxOperation(
  operation: SandboxOperation,
  environment: SandboxHost = host
): Promise<(() => Promise<void>) | undefined> {
  const inventory = await environment.inventory();
  const matches = inventory.filter(
    (entry) =>
      entry.id === operation.container || entry.name === operation.container
  );
  const target = matches.length === 1 ? matches[0] : undefined;
  if (!target)
    throw new CommandRequestError(
      "The requested sandbox is not a running Docker container."
    );
  if (!(await environment.choose(target, operation))) return undefined;
  return async () => {
    // Use the full daemon ID so removal/name reuse cannot retarget the action.
    if (
      !(await environment.inventory()).some((entry) => entry.id === target.id)
    ) {
      throw new CommandRequestError(
        "The selected sandbox is no longer running."
      );
    }
    if (operation.kind === "terminal")
      await environment.terminal(target.id, operation.user);
    else await environment.attach(target.id);
  };
}
