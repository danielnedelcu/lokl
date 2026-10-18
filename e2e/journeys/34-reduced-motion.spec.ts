import type { Locator, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { WEBSITE } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 34: reduced motion (WCAG 2.3.3). The website's smooth scrolling
// (Lenis) runs only for visitors who haven't asked their device to reduce
// motion (2026-10-17), and overlays open and close without animation
// (2026-10-18).
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

// Overlays (2026-10-18): with reduced motion asked for, dialogs, sheets,
// menus and popovers open and close without animation (the shared
// stylesheet); without it, they still animate (so this test can tell).
type Overlay = { name: string; open: (page: Page) => Promise<void>; content: (page: Page) => Locator };
const OVERLAYS: Overlay[] = [
  {
    name: "the sign-in dialog",
    open: async (page) => {
      await page.goto(`${WEBSITE}/atlanta/experiences`);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    },
    content: (page) => page.locator('[data-slot="dialog-content"]'),
  },
  {
    name: "the account menu",
    open: async (page) => {
      await page.goto(`${WEBSITE}/atlanta/experiences`);
      await page.getByRole("button", { name: "Account" }).click();
    },
    content: (page) => page.locator('[data-slot="dropdown-menu-content"]'),
  },
  {
    name: "the notification panel",
    open: async (page) => {
      await page.goto(`${WEBSITE}/dashboard`);
      await page.getByRole("button", { name: /^Notifications/ }).click();
    },
    content: (page) => page.getByRole("dialog", { name: "Notifications" }),
  },
  {
    name: "the phone menu (a sheet)",
    open: async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${WEBSITE}/dashboard`);
      await page.getByRole("button", { name: "Open menu" }).click();
    },
    content: (page) => page.locator('[data-slot="sheet-content"]'),
  },
];

for (const reduce of [true, false]) {
  test(`overlays ${reduce ? "don't animate with reduced motion" : "animate without reduced motion"}`, async ({ browser, data }) => {
    const owner = await data.user("owner");
    await data.provider(owner);
    const context = await browser.newContext({ reducedMotion: reduce ? "reduce" : "no-preference" });
    const page = await context.newPage();
    let signedIn = false;
    for (const o of OVERLAYS) {
      // The sign-in dialog is for someone signed out; the rest need a business.
      if (o.name !== "the sign-in dialog" && !signedIn) {
        await signIn(context, owner.email, owner.password);
        signedIn = true;
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await o.open(page);
      const content = o.content(page);
      await expect(content, `${o.name} opens`).toBeVisible();
      const animation = await content.evaluate((el) => getComputedStyle(el).animationName);
      // Closing: gone almost at once with no animation; still there mid-animation without.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(40);
      const stillThere = await content.count();
      if (reduce) {
        expect(animation, `${o.name}: no opening animation`).toBe("none");
        expect(stillThere, `${o.name}: gone at once when closed`).toBe(0);
      } else {
        expect(animation, `${o.name}: animates when motion is fine`).not.toBe("none");
      }
      await expect(content).toHaveCount(0);
    }
    await context.close();
  });
}
