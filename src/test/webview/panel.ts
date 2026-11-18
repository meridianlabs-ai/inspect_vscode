import { join } from "path";

import { expect, Locator, Page } from "@playwright/test";

import {
  panelDocument,
  PanelResources,
} from "../../providers/activity-bar/panel-html";

// Serves a panel's HTML, its webpack bundle and the codicons from one fake
// origin, standing in for the webview's resource root.
const kOrigin = "https://webview.test";
const kRepoRoot = join(__dirname, "..", "..", "..");

export type Message = Record<string, unknown>;

export class Panel {
  constructor(readonly page: Page) {}

  // Messages the panel has sent to the extension, oldest first.
  messages(): Promise<Message[]> {
    return this.page.evaluate(
      () => (window as unknown as { sent: Message[] }).sent
    );
  }

  // Delivers a message from the extension to the panel.
  async receive(message: Message) {
    await this.page.evaluate((m) => window.postMessage(m, "*"), message);
  }

  // The value of the last message matching `match`, read with `value`.
  // Polls, since the panels debounce what they send.
  async expectLastSent<T>(
    match: (m: Message) => boolean,
    value: (m: Message) => T,
    expected: T
  ) {
    await expect
      .poll(async () => {
        const matches = (await this.messages()).filter(match);
        const last = matches[matches.length - 1];
        return last === undefined ? undefined : value(last);
      })
      .toEqual(expected);
  }
}

// Replaces a field's text the way a user would: select it all, then type
// (or delete).
export async function typeInto(field: Locator, text: string) {
  await field.click();
  await field.press("ControlOrMeta+a");
  if (text === "") {
    await field.press("Backspace");
  } else {
    await field.pressSequentially(text);
  }
}

export async function openPanel(
  page: Page,
  script: string,
  body: string
): Promise<Panel> {
  const resources: PanelResources = {
    cspSource: kOrigin,
    nonce: "test-nonce",
    scriptUri: `${kOrigin}/out/${script}`,
    codiconCssUri: `${kOrigin}/assets/www/codicon/codicon.css`,
    codiconFontUri: `${kOrigin}/assets/www/codicon/codicon.ttf`,
  };
  const html = panelDocument(resources, body);
  await page.route(`${kOrigin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") {
      await route.fulfill({ contentType: "text/html", body: html });
    } else {
      await route.fulfill({ path: join(kRepoRoot, path) });
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as {
      sent: unknown[];
      acquireVsCodeApi: () => unknown;
    };
    w.sent = [];
    w.acquireVsCodeApi = () => ({
      postMessage: (message: unknown) => w.sent.push(message),
      getState: () => undefined,
      setState: () => undefined,
    });
  });
  await page.goto(`${kOrigin}/`);

  const panel = new Panel(page);
  await expect
    .poll(() => panel.messages())
    .toContainEqual({ command: "initialize" });
  return panel;
}
