import { expect, Page, test } from "@playwright/test";

import { inspectConfigBody } from "../../providers/activity-bar/panel-html";
import { kModelInfo } from "../../providers/activity-bar/webview/env-utils-model";

import { Message, openPanel, Panel, typeInto } from "./panel";

const kEnv = {
  provider: "openai",
  model: "gpt-4",
  modelBaseUrl: "http://localhost:8000",
  maxConnections: "5",
  maxRetries: "3",
  timeout: "60",
  logDir: "logs",
  logLevel: "info",
};

const setEnv = (key: string) => (m: Message) =>
  m.command === "setEnvValue" && m.default === key;
const value = (m: Message) => m.value;

const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const modelField = (page: Page) =>
  page.getByRole("textbox").and(page.getByPlaceholder("Model Name"));
const baseUrlField = (page: Page) =>
  page.getByRole("textbox").and(page.getByPlaceholder("Model Base Url"));
const providerField = (page: Page) =>
  page.getByRole("combobox", { name: "Provider" });
const logLevelField = (page: Page) =>
  page.getByRole("combobox", { name: "Log Level" });

test.describe("Configuration (.env) panel", () => {
  let panel: Panel;

  test.beforeEach(async ({ page }) => {
    panel = await openPanel(page, "env-config-webview.js", inspectConfigBody());
  });

  test("shows the .env values it was initialized with", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await expect(providerField(page)).toHaveValue("openai");
    await expect(modelField(page)).toHaveValue("gpt-4");
    await expect(textbox(page, "Connections")).toHaveValue("5");
    await expect(textbox(page, "Retries")).toHaveValue("3");
    await expect(textbox(page, "Timeout")).toHaveValue("60");

    await expect(baseUrlField(page)).toBeHidden();
    await page.locator("#show-base-url").click();
    await expect(baseUrlField(page)).toHaveValue("http://localhost:8000");

    await page.getByRole("tab", { name: "Logging" }).click();
    await expect(textbox(page, "Log Directory")).toHaveValue("logs");
    await expect(logLevelField(page)).toHaveValue("info");
  });

  test("saves what the user types", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await typeInto(modelField(page), "gpt-5");
    await panel.expectLastSent(setEnv("model"), value, "gpt-5");

    for (const [label, key, text] of [
      ["Connections", "maxConnections", "8"],
      ["Retries", "maxRetries", "7"],
      ["Timeout", "timeout", "120"],
    ]) {
      await typeInto(textbox(page, label!), text!);
      await panel.expectLastSent(setEnv(key!), value, text);
    }

    await typeInto(textbox(page, "Connections"), "");
    await panel.expectLastSent(setEnv("maxConnections"), value, "");

    await page.locator("#show-base-url").click();
    await typeInto(baseUrlField(page), "http://localhost:9000");
    await panel.expectLastSent(
      setEnv("modelBaseUrl"),
      value,
      "http://localhost:9000"
    );

    await page.getByRole("tab", { name: "Logging" }).click();
    await typeInto(textbox(page, "Log Directory"), "other-logs");
    await panel.expectLastSent(setEnv("logDir"), value, "other-logs");
  });

  test("typing a provider saves it and clears the model", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await typeInto(providerField(page), "anthropic");
    await providerField(page).press("Enter");

    await panel.expectLastSent(setEnv("provider"), value, "anthropic");
    await expect(modelField(page)).toHaveValue("");

    await page.getByTitle("Available Models").click();
    await panel.expectLastSent(
      (m) => m.command === "openUrl",
      (m) => m.url,
      kModelInfo.anthropic
    );
  });

  test("suggests the known providers", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });
    const suggestions = page.locator(
      `datalist#${await providerField(page).getAttribute("list")} option`
    );
    await expect(suggestions.first()).toHaveAttribute("value", "openai");
    await expect(suggestions.nth(1)).toHaveAttribute("value", "anthropic");
  });

  test("clearing the provider removes it", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });
    await expect(page.getByTitle("Available Models")).toHaveCount(1);

    await typeInto(providerField(page), "");
    await providerField(page).press("Enter");

    await panel.expectLastSent(setEnv("provider"), value, "");
    await expect(page.getByTitle("Available Models")).toHaveCount(0);
  });

  test("shows a provider that isn't in the list", async ({ page }) => {
    await panel.receive({
      type: "initialize",
      message: { env: { provider: "my-provider", model: "m" } },
    });

    await expect(providerField(page)).toHaveValue("my-provider");
  });

  test("saves a provider that isn't in the list", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await typeInto(providerField(page), "my-provider");
    await providerField(page).press("Enter");

    await panel.expectLastSent(setEnv("provider"), value, "my-provider");
  });

  test("saves a typed provider when focus moves on", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await typeInto(providerField(page), "my-provider");
    await providerField(page).press("Tab");

    await panel.expectLastSent(setEnv("provider"), value, "my-provider");
  });

  test("pressing Enter in a field saves it", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await typeInto(textbox(page, "Connections"), "8");
    await textbox(page, "Connections").press("Enter");

    await panel.expectLastSent(setEnv("maxConnections"), value, "8");
  });

  test("saves the chosen log level", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });

    await page.getByRole("tab", { name: "Logging" }).click();
    await logLevelField(page).selectOption("debug");

    await panel.expectLastSent(setEnv("logLevel"), value, "debug");
  });

  test("follows changes to .env", async ({ page }) => {
    await panel.receive({ type: "initialize", message: { env: kEnv } });
    await panel.receive({
      type: "envChanged",
      message: {
        env: { provider: "anthropic", model: "claude", maxConnections: "2" },
      },
    });

    await expect(providerField(page)).toHaveValue("anthropic");
    await expect(modelField(page)).toHaveValue("claude");
    await expect(textbox(page, "Connections")).toHaveValue("2");
    await expect(textbox(page, "Retries")).toHaveValue("");
    await page.getByRole("tab", { name: "Logging" }).click();
    await expect(textbox(page, "Log Directory")).toHaveValue("");
  });

  test("says when Inspect isn't installed", async ({ page }) => {
    await panel.receive({ type: "noPackage" });

    await expect(page.getByText("Package not installed")).toBeVisible();
    await expect(textbox(page, "Connections")).toBeHidden();
  });
});
