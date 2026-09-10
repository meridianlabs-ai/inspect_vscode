import * as path from "path";

import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(
      __dirname,
      process.env.VSCODE_TEST_VERSION === "1.93.0"
        ? "./minimumHost"
        : "./suite/index"
    );

    // Unset ELECTRON_RUN_AS_NODE so the VS Code binary launches as
    // Electron rather than plain Node.js. This var is inherited when
    // tests are run from a VS Code integrated terminal.
    delete process.env.ELECTRON_RUN_AS_NODE;

    // Download VS Code, unzip it and run the integration test
    await runTests({
      version: process.env.VSCODE_TEST_VERSION,
      extensionDevelopmentPath,
      extensionTestsPath,
      // Configure for CI environments (GitHub Actions)
      launchArgs: [
        "--no-sandbox",
        "--disable-gpu",
        ...(process.env.VSCODE_TEST_USER_DATA_DIR
          ? ["--user-data-dir", process.env.VSCODE_TEST_USER_DATA_DIR]
          : []),
      ],
      // Use headless mode when running on CI without a display
      extensionTestsEnv: { DISPLAY: process.env.DISPLAY || ":99.0" },
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

// Handle promise rejection properly to satisfy ESLint
void main().catch((err) => {
  console.error("Failed to run tests:", err);
  process.exit(1);
});
