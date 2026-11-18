import { expect, test } from "@playwright/test";

import { scoutPanelBody } from "../../providers/activity-bar/panel-html";

import { openPanel } from "./panel";

test.describe("Inspect Scout panel", () => {
  test("opens the chosen view", async ({ page }) => {
    const panel = await openPanel(
      page,
      "scout-panel-webview.js",
      scoutPanelBody()
    );
    await panel.receive({ type: "initialize" });

    await page.getByText("Scans").click();
    await panel.expectLastSent(
      (m) => m.command === "navigate",
      (m) => m.target,
      "scans"
    );
  });

  test("says when Scout isn't installed", async ({ page }) => {
    const panel = await openPanel(
      page,
      "scout-panel-webview.js",
      scoutPanelBody()
    );
    await panel.receive({ type: "noPackage" });

    await expect(page.getByText("Scout is not installed.")).toBeVisible();
    await expect(page.getByText("Scans")).toBeHidden();
  });
});
