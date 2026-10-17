import type { Locator, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 31: the notification bell's panel with more notifications than
// fit (2026-10-17), on the provider's bell and the admin's (one shared
// component, NotificationPanel): the list scrolls inside the panel, at most
// the smaller of 70% of the screen and 480px; scrolling past its end
// doesn't scroll the page behind (overscroll-behavior: contain, and
// data-lenis-prevent for the website's smooth scrolling); Tab reaches every
// notification, each scrolled into view; and at phone width the panel
// stays on screen.

const LIST = "Notifications, newest first";

/** The open panel's list, checked: it overflows, and scrolls inside itself. */
async function checkList(page: Page, list: Locator, count: number) {
  await expect(list.getByRole("button")).toHaveCount(count);
  const box = await list.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      overflowY: css.overflowY, overscroll: css.overscrollBehaviorY, maxHeight: parseFloat(css.maxHeight),
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, lenis: el.hasAttribute("data-lenis-prevent"), screen: window.innerHeight,
    };
  });
  expect(box.overflowY, "the list scrolls").toBe("auto");
  expect(box.overscroll, "scrolling past its end stays in the list").toBe("contain");
  expect(box.lenis, "the smooth-scroll library leaves it alone").toBe(true);
  expect(box.maxHeight, "at most the smaller of 70% of the screen and 480px").toBeLessThanOrEqual(Math.min(box.screen * 0.7, 480) + 0.5);
  expect(box.scrollHeight, "there's more than fits").toBeGreaterThan(box.clientHeight);
  expect(box.clientHeight).toBeLessThanOrEqual(Math.min(box.screen * 0.7, 480) + 0.5);

  // The wheel scrolls the list to its end, and never the page behind it
  // (made taller than the screen here, so it could scroll).
  await page.evaluate(() => (document.body.style.minHeight = "4000px"));
  const pageBefore = await page.evaluate(() => window.scrollY);
  await list.hover();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => list.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)).toBe(true);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY), "the page behind didn't scroll").toBe(pageBefore);

  // Tab reaches every notification, each scrolled into view in the list.
  await list.evaluate((el) => (el.scrollTop = 0));
  const buttons = list.getByRole("button");
  await buttons.first().focus();
  for (let i = 1; i < count; i++) {
    await page.keyboard.press("Tab");
    await expect(buttons.nth(i)).toBeFocused();
    const shown = await buttons.nth(i).evaluate((b) => {
      const r = b.getBoundingClientRect();
      const l = b.closest("ul")!.getBoundingClientRect();
      return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
    });
    expect(shown, `notification ${i + 1} is scrolled into view when focused`).toBe(true);
  }
}

test("the provider's bell: a long list scrolls inside the panel, by wheel and by Tab, at desktop and phone widths", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const { data: report, error } = await data.env.db.from("support_reports")
    .insert({ provider_id: provider, category: "payments", description: "My payout for last week hasn't arrived." }).select("id").single();
  if (error) throw new Error(error.message);
  // 25 replies' notifications: the bell shows the newest 20.
  const { error: notesError } = await data.env.db.from("notifications")
    .insert(Array.from({ length: 25 }, () => ({ provider_id: provider, kind: "support_reply", support_report_id: report.id })));
  if (notesError) throw new Error(notesError.message);
  await signIn(context, owner.email, owner.password);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await checkList(page, page.getByRole("list", { name: LIST }), 20);

  // At phone width: the panel stays on screen, and the list still scrolls.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await checkList(page, page.getByRole("list", { name: LIST }), 20);
});

test("the admin's bell: the same panel, scrolling inside itself", async ({ context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner, `Bell Studio ${data.run}`);
  // 20 reports (Safety: the daily limit never refuses them), each telling the admin.
  const { error } = await data.env.db.from("support_reports")
    .insert(Array.from({ length: 20 }, (_, i) => ({ provider_id: provider, category: "safety", description: `Report number ${i + 1} for the bell.` })));
  if (error) throw new Error(error.message);
  const ctx = await context.browser()!.newContext({ viewport: { width: 1280, height: 720 } });
  await signIn(ctx, admin.email, admin.password, { app: "admin" });
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await checkList(page, page.getByRole("list", { name: LIST }), 20);
  await ctx.close();
});
