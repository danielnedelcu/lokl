import type { Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { signInEmail, typeCode } from "../support/mail";
import { expect, test } from "../support/fixtures";

// Journey 22: where signing in leads (docs/design/sign-in-with-code.md,
// 2026-10-11). The homepage's "Get started" (the host card) and "Start
// hosting" (the hosting section) open the sign-in dialog and go to the
// dashboard after signing in, with focus on its main content
// (and the emailed link goes there too); signed in already, it's a link
// straight there. The header's "Sign in" keeps people on the page, and
// offers people who have a business their dashboard in the toast.

// Both of the homepage's ways to start hosting work the same way.
const starts = [
  { label: "Get started", area: "On lokl now" },
  { label: "Start hosting", area: "Got a skill? Get booked." },
] as const;
const areaOf = (page: Page, area: string) => page.getByRole("region", { name: area });

for (const { label, area } of starts) {
  test(`signed out, ${label} opens sign-in, and signing in goes to the dashboard`, async ({ page, data }) => {
    const person = await data.user("new-host");
    await page.goto("/");
    const start = areaOf(page, area).getByRole("button", { name: label });
    await expect(start).toHaveAttribute("aria-haspopup", "dialog");

    // The dialog: focus moves in, and Escape puts it back on the button.
    await start.click();
    const dialog = page.getByRole("dialog", { name: "Sign in or sign up to start hosting" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(start).toBeFocused();

    // Signed in by code: on to the dashboard, with focus on its main content.
    await start.click();
    await dialog.getByRole("textbox", { name: "Email" }).fill(person.email);
    await dialog.getByRole("button", { name: "Send me a code" }).click();
    await typeCode(page, dialog, (await signInEmail(data.env.mailpitUrl, person.email)).code);
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("#main")).toBeFocused();
    await expect(page.getByText(`Signed in as ${person.email}.`)).toBeVisible();
  });

  test(`signed out, the emailed link from ${label} goes to the dashboard too`, async ({ page, data }) => {
    const person = await data.user("link-host");
    await page.goto("/");
    await areaOf(page, area).getByRole("button", { name: label }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in or sign up to start hosting" });
    await dialog.getByRole("textbox", { name: "Email" }).fill(person.email);
    await dialog.getByRole("button", { name: "Send me a code" }).click();
    const { link } = await signInEmail(data.env.mailpitUrl, person.email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test(`signed in already, ${label} is a link straight to the dashboard`, async ({ page, context, data }) => {
    const person = await data.user("signed-in-host");
    await signIn(context, person.email, person.password);
    await page.goto("/");
    const start = areaOf(page, area).getByRole("link", { name: label });
    await expect(start).toHaveAttribute("href", "/dashboard");
    await expect(areaOf(page, area).getByRole("button", { name: label })).toHaveCount(0);
    await start.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("the header's Sign in stays on the page, and offers a business its dashboard", async ({ page, data }) => {
  const owner = await data.user("business-owner");
  await data.provider(owner);
  await page.goto("/atlanta/experiences");
  const opener = page.getByRole("button", { name: "Sign in", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Email" }).fill(owner.email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  await typeCode(page, dialog, (await signInEmail(data.env.mailpitUrl, owner.email)).code);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();

  // Still on the page, focus on the account menu that replaced "Sign in".
  await expect(page).toHaveURL(/\/atlanta\/experiences$/);
  await expect(page.locator("#account-menu")).toBeFocused();
  const offer = page.getByRole("listitem").filter({ hasText: `Signed in as ${owner.email}.` }).getByRole("button", { name: "Go to your dashboard" });
  await expect(offer).toBeVisible();
  await offer.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("the header's Sign in offers no dashboard to someone without a business", async ({ page, data }) => {
  const customer = await data.user("customer");
  await page.goto("/atlanta/experiences");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  await dialog.getByRole("textbox", { name: "Email" }).fill(customer.email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  await typeCode(page, dialog, (await signInEmail(data.env.mailpitUrl, customer.email)).code);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  // Checked while the toast is showing, and once: a retrying "none" would
  // pass when the toast closes by itself, offer or not.
  const toast = page.getByRole("listitem").filter({ hasText: `Signed in as ${customer.email}.` });
  await expect(toast).toBeVisible();
  expect(await toast.getByRole("button", { name: "Go to your dashboard" }).count(), "no dashboard offered").toBe(0);
  await expect(page.locator("#account-menu")).toBeFocused();
  await expect(page).toHaveURL(/\/atlanta\/experiences$/);
});

test("the header fits a 320px phone, signed out and signed in", async ({ page, context, data }) => {
  // The logo links home, named by its alt text; Sign in is an icon named "Sign in".
  const overflow = () => page.locator("header nav[aria-label=Main]").evaluate((nav) => nav.parentElement!.scrollWidth - nav.parentElement!.clientWidth);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "lokl", exact: true })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await overflow(), "signed out, nothing spills over").toBe(0);

  const person = await data.user("narrow");
  await signIn(context, person.email, person.password);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  expect(await overflow(), "signed in, nothing spills over").toBe(0);
});
