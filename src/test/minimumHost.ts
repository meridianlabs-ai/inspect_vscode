import { version } from "vscode";

import { verifyRunTerminal } from "./run-terminal-fixture";

// Mocha 12 requires a newer Node than VS Code 1.93 embeds. Exercise the actual
// terminal API here without loading that development-only dependency.
export async function run(): Promise<void> {
  await verifyRunTerminal();
  console.log(
    `VS Code ${version}: first and repeated Inspect/Scout Run in one reused terminal ran the environment's console script by absolute path with literal arguments, working directory and inherited environment; the PATH decoy never ran`
  );
}
