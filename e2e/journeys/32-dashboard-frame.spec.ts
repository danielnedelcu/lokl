import type { Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 32: both dashboards' frame stays put (2026-10-17): with the page
// scrolled, the top bar is still at the top, and the sidebar fills the
// screen with the email and "Sign out" at its bottom.

async function checkFrame(page: Page) {
  // A page longer than the screen, scrolled well down (once it's drawn: the admin app renders in the browser).
  await page.locator("main").waitFor();
  await page.evaluate(() => {
    document.querySelector("main")!.style.minHeight = "4000px";
    window.scrollTo(0, 2000);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const screen = page.viewportSize()!;
  const bell = (await page.getByRole("button", { name: /^Notifications/ }).boundingBox())!;
  // On screen, within the top bar (not scrolled away above it).
  expect(bell.y, "the top bar is still at the top").toBeGreaterThanOrEqual(0);
  expect(bell.y + bell.height, "the top bar is still at the top").toBeLessThanOrEqual(56);
  const signOut = page.getByRole("complementary").getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeInViewport();
  const box = (await signOut.boundingBox())!;
  expect(screen.height - (box.y + box.height), "\"Sign out\" is at the bottom of the screen").toBeLessThan(40);
  const aside = (await page.getByRole("complementary").boundingBox())!;
  expect(aside.y).toBe(0);
  expect(aside.height).toBe(screen.height);
}

test("the provider's dashboard: the top bar and sidebar stay put, with \"Sign out\" at the bottom", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  await data.provider(owner);
  await signIn(context, owner.email, owner.password);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/dashboard");
  await checkFrame(page);
});

test("the admin app: the same", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const ctx = await context.browser()!.newContext({ viewport: { width: 1280, height: 720 } });
  await signIn(ctx, admin.email, admin.password, { app: "admin" });
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/`);
  await checkFrame(page);
  await ctx.close();
});
