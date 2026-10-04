import type { Page } from "@playwright/test";
import { daysFromNow } from "../support/data";
import { signInEmail } from "../support/mail";
import { expect, test } from "../support/fixtures";

// Journey 5: the real sign-in (docs/design/sign-in-with-code.md). A
// signed-out visitor asks to book, gets an email (caught by the local
// stack's Mailpit) and signs in with its code in the dialog, without
// leaving the listing; or opens its link in the same browser and comes back
// to the listing.

async function listingToBook(data: Parameters<Parameters<typeof test>[2]>[0]["data"]) {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  await data.session(listing.id, daysFromNow(4));
  return listing;
}

async function askForCode(page: Page, email: string) {
  await page.getByRole("button", { name: "Sign in to book" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to book" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  return dialog;
}

test("sign in to book with the emailed code, without leaving the listing", async ({ page, data }) => {
  const customer = await data.user("coded");
  const listing = await listingToBook(data);

  await page.goto(`/experiences/${listing.slug}`);
  const dialog = await askForCode(page, customer.email);
  const code = dialog.getByLabel("6-digit code");
  await expect(code).toBeFocused();
  await expect(dialog).toContainText(customer.email);

  const email = await signInEmail(data.env.mailpitUrl, customer.email);
  await code.fill(email.code);
  await dialog.getByRole("button", { name: "Sign in" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/experiences/${listing.slug}$`));
  await expect(page.getByText(`Signed in as ${customer.email}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  // "Sign in to book" is gone, so focus goes to the panel above the form.
  await expect(page.locator("#booking-panel-start")).toBeFocused();
});

test("the emailed link still works, and comes back to the listing", async ({ page, data }) => {
  const customer = await data.user("emailed");
  const listing = await listingToBook(data);

  await page.goto(`/experiences/${listing.slug}`);
  await askForCode(page, customer.email);
  const email = await signInEmail(data.env.mailpitUrl, customer.email);

  await page.goto(email.link);
  await expect(page).toHaveURL(new RegExp(`/experiences/${listing.slug}$`), { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeVisible();
});
