import { expect, Page, test } from "@playwright/test";

import { taskConfigBody } from "../../providers/activity-bar/panel-html";

import { Message, openPanel, Panel, typeInto } from "./panel";

const task = (params: string[]) => ({
  document: { fsPath: "/work/tasks.py" },
  tasks: [],
  activeTask: { name: "my_task", params, line: 1 },
});

const kState = {
  limit: "10",
  epochs: "2",
  maxTokens: "512",
  temperature: "0.7",
  topP: "0.9",
  topK: "40",
  params: { dataset: "train" },
};

const setState = (key: string) => (m: Message) =>
  m.command === "setStateValue" && m.key === key;
const setParam = (key: string) => (m: Message) =>
  m.command === "setStateParam" && m.key === key;
const value = (m: Message) => m.value;

const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });

test.describe("Task panel", () => {
  let panel: Panel;

  test.beforeEach(async ({ page }) => {
    panel = await openPanel(page, "task-config-webview.js", taskConfigBody());
  });

  test("says when no task is selected", async ({ page }) => {
    await panel.receive({ type: "initialize" });

    await expect(page.getByText("No task selected")).toBeVisible();
    await expect(textbox(page, "Limit")).toBeHidden();
  });

  test("says when Inspect isn't installed", async ({ page }) => {
    await panel.receive({ type: "noPackage" });

    await expect(page.getByText("Package not installed.")).toBeVisible();
    await expect(textbox(page, "Limit")).toBeHidden();
  });

  test("shows the active task's options", async ({ page }) => {
    await panel.receive({ type: "initialize" });
    await panel.receive({
      type: "setActiveTask",
      task: task(["dataset"]),
      state: kState,
    });

    await expect(page.getByText("No task selected")).toBeHidden();
    await expect(textbox(page, "Limit")).toHaveValue("10");
    await expect(textbox(page, "Epochs")).toHaveValue("2");
    await expect(textbox(page, "Max Tokens")).toHaveValue("512");
    await expect(textbox(page, "Temperature")).toHaveValue("0.7");
    await expect(textbox(page, "Top P")).toHaveValue("0.9");
    await expect(textbox(page, "Top K")).toHaveValue("40");
    await expect(textbox(page, "Sample Ids")).toHaveValue("");
  });

  test("saves the options the user types", async ({ page }) => {
    await panel.receive({
      type: "setActiveTask",
      task: task([]),
      state: {},
    });

    for (const [label, key, text] of [
      ["Limit", "limit", "5"],
      ["Epochs", "epochs", "3"],
      ["Max Tokens", "maxTokens", "1024"],
      ["Temperature", "temperature", "0.2"],
      ["Top P", "topP", "0.5"],
      ["Top K", "topK", "8"],
    ]) {
      await typeInto(textbox(page, label!), text!);
      await panel.expectLastSent(setState(key!), value, text);
    }

    await typeInto(textbox(page, "Limit"), "");
    await panel.expectLastSent(setState("limit"), value, "");

    await typeInto(textbox(page, "Sample Ids"), "1,2");
    await panel.expectLastSent(setState("sampleIds"), value, "1,2");
  });

  test("pressing Enter in an option saves it", async ({ page }) => {
    await panel.receive({ type: "setActiveTask", task: task([]), state: {} });

    await typeInto(textbox(page, "Limit"), "5");
    await textbox(page, "Limit").press("Enter");

    await panel.expectLastSent(setState("limit"), value, "5");
  });

  test("lists the task's arguments and saves them", async ({ page }) => {
    await panel.receive({
      type: "setActiveTask",
      task: task(["dataset", "shuffle"]),
      state: kState,
    });

    await page.getByRole("tab", { name: "Task Args" }).click();
    await expect(textbox(page, "dataset")).toHaveValue("train");
    await expect(textbox(page, "shuffle")).toHaveValue("");

    await typeInto(textbox(page, "shuffle"), "true");
    await panel.expectLastSent(setParam("shuffle"), value, "true");

    await typeInto(textbox(page, "dataset"), "");
    await panel.expectLastSent(setParam("dataset"), value, "");
  });

  test("replaces the arguments when the task changes", async ({ page }) => {
    await panel.receive({
      type: "setActiveTask",
      task: task(["dataset"]),
      state: kState,
    });
    await panel.receive({
      type: "setActiveTask",
      task: task(["seed"]),
      state: {},
    });

    await page.getByRole("tab", { name: "Task Args" }).click();
    await expect(textbox(page, "seed")).toBeVisible();
    await expect(textbox(page, "dataset")).toHaveCount(0);
  });

  test("says when the task has no arguments", async ({ page }) => {
    await panel.receive({ type: "setActiveTask", task: task([]), state: {} });

    await page.getByRole("tab", { name: "Task Args" }).click();
    await expect(page.getByText("No arguments for this task")).toBeVisible();
  });

  test("won't take both a limit and sample ids", async ({ page }) => {
    await panel.receive({
      type: "setActiveTask",
      task: task([]),
      state: { limit: "10" },
    });
    const error = page.getByText(
      "Cannot set both limit and sample ids. Please choose one."
    );
    await expect(error).toBeHidden();

    await typeInto(textbox(page, "Sample Ids"), "1,2");
    await expect(error).toBeVisible();
    await expect(textbox(page, "Limit")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(textbox(page, "Sample Ids")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    // The test page has no theme, so the colours are the stylesheet's
    // fallbacks: an error border on the invalid field, and the focus border on
    // the invalid field being typed in.
    await expect(textbox(page, "Limit")).toHaveCSS(
      "border-color",
      "rgb(190, 17, 0)"
    );
    await expect(textbox(page, "Sample Ids")).toHaveCSS(
      "border-color",
      "rgb(0, 120, 212)"
    );

    await typeInto(textbox(page, "Limit"), "");
    await expect(error).toBeHidden();
    await expect(textbox(page, "Limit")).not.toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(textbox(page, "Sample Ids")).not.toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });
});
