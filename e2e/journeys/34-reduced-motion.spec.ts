import { WEBSITE } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 34: the website's smooth scrolling (Lenis) runs only for visitors
// who haven't asked their device to reduce motion (WCAG 2.3.3, 2026-10-17).
// Lenis marks the page's root element with the class "lenis" while it runs.

test("smooth scrolling runs by default", async ({ page }) => {
  await page.goto("/atlanta/experiences");
  await expect(page.locator("html")).toHaveClass(/(^|\s)lenis(\s|$)/);
});

test("with reduced motion asked for, the browser's own scrolling is used", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${WEBSITE}/atlanta/experiences`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)lenis(\s|$)/);
  // The page still scrolls, by the browser.
  await page.evaluate(() => (document.body.style.minHeight = "4000px"));
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await context.close();
});
