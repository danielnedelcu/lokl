import { appendFileSync } from "node:fs";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { TestData } from "./data";

// A page is used once it has hydrated (2026-10-19): after goto or reload on
// one of the apps (3200, 3201, 3202), wait for <html data-hydrated>
// (packages/ui/app/plugins/hydrated.client.ts). Under four workers, a click
// straight after loading sometimes landed on server-rendered HTML and was
// lost. Other sites (Stripe's stub, the analytics server) aren't waited for.
const APP = /^http:\/\/localhost:32(00|01|02)\//;
// E2E_RECORD_VISITS=<file>: each page an app lands on is noted there with
// its journey (scripts/journey-map.mjs's map, checked against real runs).
let currentJourney = "";
export const recordingJourney = (file: string) => { currentJourney = file; };
function recordsVisits(page: Page) {
  const to = process.env.E2E_RECORD_VISITS;
  if (!to) return;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || !APP.test(frame.url())) return;
    const u = new URL(frame.url());
    appendFileSync(to, `${currentJourney}\t${u.port === "3201" ? "admin" : "website"}\t${u.pathname}\n`);
  });
}
function waitsForHydration(page: Page) {
  recordsVisits(page);
  const ready = async () => {
    if (APP.test(page.url())) await page.locator("html[data-hydrated]").waitFor({ state: "attached", timeout: 30_000 });
  };
  const goto = page.goto.bind(page);
  page.goto = async (...args: Parameters<Page["goto"]>) => {
    const res = await goto(...args);
    await ready();
    return res;
  };
  const reload = page.reload.bind(page);
  page.reload = async (...args: Parameters<Page["reload"]>) => {
    const res = await reload(...args);
    await ready();
    return res;
  };
}
function contextWaitsForHydration(context: BrowserContext) {
  context.pages().forEach(waitsForHydration);
  context.on("page", waitsForHydration);
}

// Each test gets its own TestData, removed afterwards even if the test fails.
export const test = base.extend<{ data: TestData }>({
  // Any context a journey opens with browser.newContext() (patched once per
  // worker), and the test's own.
  browser: [async ({ browser }, use) => {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
      const opened = await newContext(...args);
      contextWaitsForHydration(opened);
      return opened;
    };
    await use(browser);
  }, { scope: "worker" }],
  context: async ({ context }, use, testInfo) => {
    recordingJourney(testInfo.file.replace(/^.*\/e2e\//, "e2e/"));
    contextWaitsForHydration(context);
    await use(context);
  },
  // eslint-disable-next-line no-empty-pattern
  data: async ({}, use) => {
    const data = await TestData.create();
    try {
      await use(data);
    } finally {
      await data.cleanup();
    }
  },
});
export { expect };

/**
 * Stop at Stripe's door (decided 2026-10-04: tests never pay on Stripe's
 * hosted page). Requests to Checkout get a stub page; returns the address
 * the browser was sent to, once it's been sent there.
 */
export async function stopAtStripe(page: Page) {
  await page.route(/^https:\/\/checkout\.stripe\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe Checkout (not loaded in tests)</title>" }),
  );
  return async () => {
    await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//);
    return page.url();
  };
}
