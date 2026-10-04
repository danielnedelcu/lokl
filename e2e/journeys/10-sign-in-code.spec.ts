import type { Page } from "@playwright/test";
import { ADMIN } from "../support/env";
import { signInEmail, wrongCode } from "../support/mail";
import { expect, test } from "../support/fixtures";

// Journey 10: the sign-in form's code step (docs/design/sign-in-with-code.md):
// labels and focus, wrong codes and the lock after five, resending, expiry,
// Supabase's verify limit, and the admin app.

/** Opens the header's sign-in dialog and asks for a code. */
async function askForCode(page: Page, email: string) {
  await page.goto("/atlanta/experiences");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();
  return dialog;
}

test("the dialog's fields are labelled, and focus goes back where it was", async ({ page }) => {
  await page.goto("/atlanta/experiences");
  const opener = page.getByRole("button", { name: "Sign in", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  const email = dialog.getByRole("textbox", { name: "Email" });
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(email).toHaveAccessibleDescription("New to lokl? This creates your account.");
  // A bad address isn't sent; the message is linked to the field.
  await email.fill("not-an-email");
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter your email address, like name@example.com.");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("wrong codes say so, count down, and lock after five", async ({ page, data }) => {
  const customer = await data.user("wrong-codes");
  const dialog = await askForCode(page, customer.email);
  const code = dialog.getByRole("textbox", { name: "6-digit code" });
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toHaveAttribute("inputmode", "numeric");
  const real = (await signInEmail(data.env.mailpitUrl, customer.email)).code;
  const signIn = dialog.getByRole("button", { name: "Sign in" });

  await code.fill("123");
  await signIn.click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the 6-digit code from the email.");

  const expected = [
    "That code isn't right. Check the email and try again.",
    "That code isn't right. Check the email and try again.",
    "That code isn't right. Check the email and try again. 2 tries left.",
    "That code isn't right. Check the email and try again. 1 try left.",
  ];
  for (const message of expected) {
    await code.fill(wrongCode(real));
    await signIn.click();
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await expect(code).toBeFocused();
    await expect(code).toHaveAccessibleDescription(new RegExp(message.replace(/[.?]/g, "\\$&")));
  }
  await code.fill(wrongCode(real));
  await signIn.click();
  await expect(dialog.getByRole("alert")).toHaveText("That's 5 wrong codes. Send a new code to try again.");
  await expect(code).toBeDisabled();
  await expect(signIn).toBeDisabled();
  // Resending isn't open yet (under a minute), so focus goes to the other way on.
  await expect(dialog.getByRole("button", { name: "Use a different email" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: /^Send a new code in \d+ s$/ })).toBeDisabled();
});

test("a new code replaces the old one; a pasted code with spaces works", async ({ page, data }) => {
  const customer = await data.user("resend");
  await page.clock.install();
  const dialog = await askForCode(page, customer.email);
  const first = await signInEmail(data.env.mailpitUrl, customer.email);

  const resend = dialog.getByRole("button", { name: /^Send a new code/ });
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(61_000);
  // The page's clock moved, not the server's: the local stack refuses a
  // second send to one address within a second (the hosted one, a minute).
  await page.waitForTimeout(1500);
  await expect(resend).toHaveText("Send a new code");
  await resend.click();
  const second = await signInEmail(data.env.mailpitUrl, customer.email, first);
  await expect(dialog.getByLabel("6-digit code")).toBeFocused();

  const code = dialog.getByLabel("6-digit code");
  if (first.code !== second.code) {
    await code.fill(first.code);
    await dialog.getByRole("button", { name: "Sign in" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That code isn't right. Check the email and try again.");
  }
  await code.fill(`${second.code.slice(0, 3)} ${second.code.slice(3)}`);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account" })).toBeFocused();
});

test("an expired code says so, without asking Supabase", async ({ page, data }) => {
  const customer = await data.user("expired");
  await page.clock.install();
  const dialog = await askForCode(page, customer.email);
  const real = (await signInEmail(data.env.mailpitUrl, customer.email)).code;
  let verifies = 0;
  await page.route(/\/auth\/v1\/verify/, (route) => {
    verifies++;
    return route.continue();
  });
  await page.clock.fastForward(10 * 60_000);
  const code = dialog.getByLabel("6-digit code");
  await code.fill(real);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This code has expired. Send a new code.");
  await expect(code).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Send a new code" })).toBeFocused();
  expect(verifies).toBe(0);
});

test("Supabase's verify limit gets a plain message", async ({ page, data }) => {
  const customer = await data.user("limited");
  const dialog = await askForCode(page, customer.email);
  await signInEmail(data.env.mailpitUrl, customer.email);
  await page.route(/\/auth\/v1\/verify/, (route) => route.fulfill({
    status: 429, contentType: "application/json",
    body: JSON.stringify({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }),
  }));
  await dialog.getByLabel("6-digit code").fill("123456");
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Too many tries from this device. Wait a few minutes, then try again.");
  await expect(dialog.getByLabel("6-digit code")).toBeEnabled();
});

test("the admin app signs in by code, and doesn't create accounts", async ({ page, data }) => {
  const admin = await data.user("admin", { admin: true });
  await page.goto(`${ADMIN}/login`);
  const unknown = `nobody-${data.run}@test.local`;
  await page.getByLabel("Email").fill(unknown);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("alert")).toHaveText("We couldn't send a sign-in code. Check this is an admin's email address, or try again in a minute.");
  await expect(page.getByText("New to lokl?")).toHaveCount(0);

  await page.getByLabel("Email").fill(admin.email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  const email = await signInEmail(data.env.mailpitUrl, admin.email);
  await page.getByLabel("6-digit code").fill(email.code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`^${ADMIN}/?$`), { timeout: 20_000 });
  const { data: users } = await data.env.db.auth.admin.listUsers({ perPage: 1000 });
  expect(users.users.some((u) => u.email === unknown), "no account was made for the unknown address").toBe(false);
});
