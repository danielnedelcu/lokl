import type { Locator, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import type { TestData } from "../support/data";
import { expect, test } from "../support/fixtures";
import { signInEmail, typeCode } from "../support/mail";

// Journey 9: favourites, "Saved" (docs/design/favourites.md).

/** A provider with a live experience; returns what the tests need. */
async function provider(data: TestData, label: string) {
  const owner = await data.user(`${label}-owner`);
  const name = `E2E ${label} ${data.run}`;
  const id = await data.provider(owner, name);
  const listing = await data.listing(id, "experience", (await data.category("experience")).id, await data.area());
  const { data: row } = await data.env.db.from("providers").select("slug").eq("id", id).single();
  return { owner, id, name, listing, slug: (row as { slug: string }).slug };
}

/** A heart, once the person's saved items have loaded (it responds then). */
async function heart(page: Page, name: string): Promise<Locator> {
  const button = page.getByRole("button", { name: `Save ${name}`, exact: true });
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  return button;
}

async function savedRows(data: TestData, customerId: string) {
  const [l, p] = await Promise.all([
    data.env.db.from("saved_listings").select("listing_id").eq("customer_id", customerId),
    data.env.db.from("saved_providers").select("provider_id").eq("customer_id", customerId),
  ]);
  return { listings: (l.data ?? []).map((r) => r.listing_id as string), providers: (p.data ?? []).map((r) => r.provider_id as string) };
}

test("a customer saves a listing and a provider, finds them on the Saved page, and undoes a removal", async ({ page, context, data }) => {
  test.setTimeout(120_000);
  const p = await provider(data, "Peach");
  const customer = await data.user("saver");
  await signIn(context, customer.email, customer.password);

  // On the profile page: the provider's heart beside the name, and a heart on
  // each listing card, a separate tab stop after the card's link.
  await page.goto(`/providers/${p.slug}`);
  const providerHeart = await heart(page, p.name);
  await expect(providerHeart).toHaveAttribute("aria-pressed", "false");
  await providerHeart.click();
  await expect(providerHeart).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Saved ${p.name}`, { exact: true })).toBeAttached();

  await page.getByRole("link", { name: p.listing.title }).focus();
  await page.keyboard.press("Tab");
  const cardHeart = await heart(page, p.listing.title);
  await expect(cardHeart).toBeFocused();
  await page.keyboard.press("Space");
  await expect(cardHeart).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => savedRows(data, customer.id)).toEqual({ listings: [p.listing.id], providers: [p.id] });

  // Enter toggles too (and back).
  await page.keyboard.press("Enter");
  await expect(cardHeart).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(cardHeart).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([p.listing.id]);

  // Still saved after a reload, and on the listing's own page.
  await page.reload();
  await expect(await heart(page, p.name)).toHaveAttribute("aria-pressed", "true");
  await expect(await heart(page, p.listing.title)).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/experiences/${p.listing.slug}`);
  await expect(await heart(page, p.listing.title)).toHaveAttribute("aria-pressed", "true");

  // The Saved page, from the account menu.
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Saved" }).click();
  await expect(page).toHaveURL(/\/account\/saved$/);
  await expect(page.getByRole("heading", { name: "Listings (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Providers (1)" })).toBeVisible();
  await expect(page.getByRole("link", { name: p.listing.title })).toBeVisible();
  await expect(page.getByRole("link", { name: p.name })).toBeVisible();

  // Unsaving here keeps it on the page, with Undo.
  await (await heart(page, p.listing.title)).click();
  const undo = page.getByRole("button", { name: `Undo: save ${p.listing.title} again` });
  await expect(undo).toBeVisible();
  await expect(page.getByRole("link", { name: p.listing.title }), "the card stays").toBeVisible();
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([]);
  await undo.click();
  await expect(undo).toHaveCount(0);
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([p.listing.id]);

  // lokl takes the listing down: it stays, without its name, photo or link.
  await data.env.db.from("listings").update({ status: "unpublished", unpublished_reason: "Taken down by the end-to-end tests." }).eq("id", p.listing.id);
  await page.reload();
  const listingsSection = page.getByRole("region", { name: "Listings (1)" });
  await expect(listingsSection.getByText("A listing that's no longer available")).toBeVisible();
  await expect(listingsSection.getByText("No longer available", { exact: true })).toBeVisible();
  // It was the provider's only live listing, so their profile isn't public
  // either; they unlisted nothing wrong themselves, so they keep their name.
  const providersSection = page.getByRole("region", { name: "Providers (1)" });
  await expect(providersSection.getByText(p.name, { exact: true })).toBeVisible();
  await expect(providersSection.getByText("No longer available", { exact: true })).toBeVisible();
  await expect(providersSection.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("link", { name: p.listing.title })).toHaveCount(0);
  await expect(page.getByText(p.listing.title)).toHaveCount(0);
  await page.getByRole("button", { name: "Remove A listing that's no longer available" }).click();
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([]);
});

test("a listing its provider unlisted keeps its name; a provider sees no heart on their own", async ({ page, context, data }) => {
  const p = await provider(data, "Quiet");
  const customer = await data.user("saver");
  await data.env.db.from("saved_listings").insert({ customer_id: customer.id, listing_id: p.listing.id });
  await data.env.db.from("listings").update({ status: "draft" }).eq("id", p.listing.id);

  await signIn(context, customer.email, customer.password);
  await page.goto("/account/saved");
  const row = page.getByRole("listitem").filter({ hasText: p.listing.title });
  await expect(row).toContainText("No longer available");
  await expect(row.getByRole("button", { name: `Remove ${p.listing.title}` })).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);

  // The provider, on their own profile and listing: no heart.
  await data.env.db.from("listings").update({ status: "live" }).eq("id", p.listing.id);
  await context.clearCookies();
  await signIn(context, p.owner.email, p.owner.password);
  await page.goto(`/experiences/${p.listing.slug}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: `Save ${p.listing.title}` })).toHaveCount(0);
  await page.goto(`/providers/${p.slug}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
});

test("a save that fails flips the heart back and says why", async ({ page, context, data }) => {
  const p = await provider(data, "Offline");
  const customer = await data.user("saver");
  await signIn(context, customer.email, customer.password);
  await page.goto(`/experiences/${p.listing.slug}`);
  const button = await heart(page, p.listing.title);
  await page.route(/\/rest\/v1\/saved_listings/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await button.click();
  await expect(page.getByText(`${p.listing.title} wasn't saved. Check your connection and try again.`)).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect((await savedRows(data, customer.id)).listings).toEqual([]);
});

test("a signed-out visitor taps a heart, signs in with the code, and it's saved without leaving the page", async ({ page, data }) => {
  const p = await provider(data, "Return");
  const customer = await data.user("coded-saver");

  await page.goto(`/experiences/${p.listing.slug}`);
  const button = await heart(page, p.listing.title);
  await button.click();
  const dialog = page.getByRole("dialog", { name: `Sign in to save ${p.listing.title}` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(customer.email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  const email = await signInEmail(data.env.mailpitUrl, customer.email);
  await typeCode(page, dialog, email.code);
  await dialog.getByRole("button", { name: "Sign in" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/experiences/${p.listing.slug}$`));
  await expect(page.getByText(`Saved ${p.listing.title}.`)).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button, "focus is back on the heart").toBeFocused();
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([p.listing.id]);
});

test("a signed-out visitor taps a heart, signs in by the emailed link, and comes back with it saved", async ({ page, context, data }) => {
  const p = await provider(data, "Linked");
  const customer = await data.user("emailed-saver");

  await page.goto(`/experiences/${p.listing.slug}`);
  await (await heart(page, p.listing.title)).click();
  const dialog = page.getByRole("dialog", { name: `Sign in to save ${p.listing.title}` });
  await dialog.getByLabel("Email").fill(customer.email);
  await dialog.getByRole("button", { name: "Send me a code" }).click();
  const email = await signInEmail(data.env.mailpitUrl, customer.email);

  await page.goto(email.link);
  await expect(page).toHaveURL(new RegExp(`/experiences/${p.listing.slug}$`), { timeout: 20_000 });
  await expect(page.getByText(`Saved ${p.listing.title}.`)).toBeVisible();
  await expect(await heart(page, p.listing.title)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await savedRows(data, customer.id)).listings).toEqual([p.listing.id]);

  // Once only: the intent is cleared, and a reload doesn't announce it again.
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === "lokl_save_intent"), { message: "the intent cookie is cleared" }).toBe(false);
  await page.reload();
  await expect(await heart(page, p.listing.title)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Saved ${p.listing.title}.`)).toHaveCount(0);
});
