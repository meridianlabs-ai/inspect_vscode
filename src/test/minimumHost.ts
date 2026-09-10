import { version } from "vscode";

import { verifyRunTerminal } from "./run-terminal-fixture";

// Mocha 12 requires a newer Node than VS Code 1.93 embeds. Exercise the actual
// terminal API here without loading that development-only dependency.
export async function run(): Promise<void> {
  await verifyRunTerminal();
  console.log(
    `VS Code ${version}: first/repeated Run, startup shell replacement, argv, cwd and activation passed`
  );
}
