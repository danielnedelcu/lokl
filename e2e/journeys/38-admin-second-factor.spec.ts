import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";
import { typeCode } from "../support/mail";
import { freshTotp } from "../support/totp";
import type { Page } from "@playwright/test";

// Journey 38: an admin's second factor (docs/design/admin-roles.md, cutover
// step 2), optional for now. Setting up an authenticator from a QR code drawn
// here or a key in groups of four, shown only while setting up; a second one;
// signing in again asks for the second step; removing the last one is
// warned about. (Journey 33 checks these pages fetch nothing from other sites.)

/** Sets up an authenticator on /security with this name; returns its key. */
async function setUp(page: Page, name: string) {
  await page.getByRole("button", { name: /^(Set up an authenticator|Add another authenticator)$/ }).click();
  await page.getByLabel("Name it").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: `Add lokl to ${name}` })).toBeFocused();
  // Supabase's own QR code, drawn here, with its text alternative pointing to the key.
  const qr = page.getByRole("img", { name: /QR code for your authenticator app\. If you can't scan it, use the key below instead\./ });
  await expect(qr).toHaveAttribute("src", /^data:image\/svg/);
  const shown = (await page.locator("#authenticator-key").innerText()).trim();
  expect(shown, "the key in groups of four").toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
  await expect(page.getByRole("button", { name: "Copy the key" })).toBeVisible();
  const key = shown.replace(/\s/g, "");
  await typeCode(page, page, await freshTotp(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(`${name} is set up.`).first()).toBeVisible();
  // Never shown again.
  await expect(page.locator("#authenticator-key")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  return key;
}

test("an admin sets up two authenticators; signing in again asks for the second step", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();

  // Optional for now: the admin app works, with a reminder.
  await page.goto(`${ADMIN}/`);
  await expect(page.getByText("Admin access will soon need a second step after the emailed code.")).toBeVisible();
  await page.getByRole("link", { name: "Set up your authenticator" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Second factor" })).toBeVisible();

  const phone = await setUp(page, "Phone");
  await expect(page.getByText("Add a second one, so losing this one doesn't lock you out.")).toBeVisible();
  // A name can't be used twice.
  await page.getByRole("button", { name: "Add another authenticator" }).click();
  await page.getByLabel("Name it").fill("phone");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("You already have an authenticator with that name.");
  await page.getByRole("button", { name: "Cancel" }).click();
  const backup = await setUp(page, "Password manager");
  await expect(page.getByRole("listitem").filter({ hasText: "Added" })).toHaveCount(2);
  expect(backup).not.toBe(phone);
  await expect(page.getByText("Admin access will soon need a second step")).toHaveCount(0);

  // Removing one of two: no warning.
  await page.getByRole("button", { name: "Remove Phone" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("You can still sign in with your other authenticator.");
  await page.getByRole("button", { name: "Keep it" }).click();

  // Signing in again: the emailed code (here, the test sign-in) is the first step only.
  await context.clearCookies();
  await signIn(context, admin.email, admin.password, { app: "admin" });
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/security\/verify\?to=(%2F|\/)bookings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Second step" })).toBeVisible();
  await page.getByRole("radio", { name: "Password manager" }).click();
  await typeCode(page, page, "000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work.");
  await typeCode(page, page, await freshTotp(backup));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${ADMIN}/bookings`);
});

test("removing your only authenticator is warned about while they're optional", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await setUp(page, "Phone");
  await page.getByRole("button", { name: "Remove Phone" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This is your only authenticator.");
  await expect(dialog).toContainText("admin access will soon require an authenticator");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Phone is removed.").first()).toBeVisible();
  await expect(page.getByText("None yet. Set one up now")).toBeVisible();
});

test("on a phone, setting up offers to open the authenticator app directly @phone", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await page.getByRole("button", { name: "Set up an authenticator" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const open = page.getByRole("link", { name: "Open in authenticator app" });
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /^otpauth:\/\/totp\//);
  } else {
    // On a computer the authenticator is on another device: scan or type the key.
    await expect(open).toBeHidden();
  }
  // Nothing scrolls sideways at this width, QR code and key included.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
