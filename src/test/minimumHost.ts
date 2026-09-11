import { version } from "vscode";

import { verifyRunTerminal } from "./run-terminal-fixture";

// Mocha 12 requires a newer Node than VS Code 1.93 embeds. Exercise the actual
// terminal API here without loading that development-only dependency.
export async function run(): Promise<void> {
  if (!(await verifyRunTerminal())) {
    throw new Error(
      "The minimum-host terminal regression requires fish on Unix."
    );
  }
  const powershell = await verifyRunTerminal("powershell");
  console.log(
    `PowerShell smart-quote Run regression: ${powershell ? "passed" : "skipped (PowerShell unavailable)"}`
  );
  console.log(
    `VS Code ${version}: first/repeated Run, startup shell replacement, argv, cwd and activation passed`
  );
}
