import { test as base, expect, type Page } from "@playwright/test";
import { TestData } from "./data";

// Each test gets its own TestData, removed afterwards even if the test fails.
export const test = base.extend<{ data: TestData }>({
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
