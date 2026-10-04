import { daysFromNow } from "../support/data";
import { expect, test } from "../support/fixtures";

// Journey 5: the real sign-in, once per run. A signed-out visitor asks to
// book, gets an emailed link (caught by the local stack's Mailpit; nothing
// is really sent), opens it in the same browser, and lands back on the
// listing, signed in.

test("sign in by emailed link from a listing, and come back to it", async ({ page, data }) => {
  const customer = await data.user("emailed");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  await data.session(listing.id, daysFromNow(4));

  await page.goto(`/experiences/${listing.slug}`);
  await page.getByRole("button", { name: "Sign in to book" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  await expect(page.getByRole("status").filter({ hasText: customer.email })).toBeVisible();

  // The email, from Mailpit's API.
  const mailpit = data.env.mailpitUrl.replace(/\/$/, "");
  let messageId = "";
  await expect.poll(async () => {
    const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${customer.email}`)}`);
    messageId = ((await res.json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID ?? "";
    return messageId;
  }, { message: "the sign-in email arrives", timeout: 20_000 }).not.toBe("");
  const message = (await (await fetch(`${mailpit}/api/v1/message/${messageId}`)).json()) as { Text?: string; HTML?: string };
  const link = `${message.Text ?? ""} ${message.HTML ?? ""}`.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/)?.[0]?.replaceAll("&amp;", "&");
  expect(link, "the email has a sign-in link").toBeTruthy();

  // Open it in the same browser: back on the listing, signed in.
  await page.goto(link!);
  await expect(page).toHaveURL(new RegExp(`/experiences/${listing.slug}$`), { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeVisible();
});
