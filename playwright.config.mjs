import { defineConfig } from "@playwright/test";

// Webview tests: load each activity bar panel's HTML and webpack bundle in
// Chromium and drive it like a user. Run `pnpm build` first.
export default defineConfig({
  testDir: "src/test/webview",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { browserName: "chromium" },
});
