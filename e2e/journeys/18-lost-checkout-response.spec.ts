import type { Page } from "@playwright/test";
import { atlantaDate, atlantaTime, daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, stopAtStripe, test } from "../support/fixtures";

// Journey 18: the reply to "Continue to payment" is lost after the server has
// made the booking (a dropped connection). The customer presses again: they
// go to the same Checkout, with exactly one booking and its spots held once
// (the page's checkout key; server/utils/bookings.ts). If they change the
// details first, the new attempt ends the lost one, so it can't block them.

/** Lets the first booking request reach the server, then drops its reply. */
async function dropFirstReply(page: Page, path: string) {
  let dropped = false;
  await page.route(`**${path}`, async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch(); // the server makes the booking
    await route.abort("connectionreset"); // the browser never hears back
  });
}

async function openExperience(page: Page, slug: string, startsAt: string) {
  await page.goto(`/experiences/${slug}`);
  await page.locator("label").filter({ hasText: atlantaDate(startsAt) }).filter({ hasText: atlantaTime(startsAt) }).click();
  await page.getByLabel("Your name").fill("Sam Customer");
}

test("an Experience: the reply is lost, the customer presses again, one booking", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const startsAt = daysFromNow(4);
  const sessionId = await data.session(listing.id, startsAt, 2); // exactly 2 spots
  await signIn(context, customer.email, customer.password);

  await openExperience(page, listing.slug, startsAt);
  await page.getByLabel("How many people?").fill("2");
  await dropFirstReply(page, "/api/bookings/experience");
  const sentToStripe = await stopAtStripe(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("alert")).toHaveText("Checkout couldn't be started. Please try again.");

  await page.getByRole("button", { name: "Continue to payment" }).click();
  const stripeUrl = await sentToStripe();

  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  expect(rows, "exactly one booking").toHaveLength(1);
  expect(rows![0].status).toBe("pending_payment");
  expect(stripeUrl, "...and it's the Checkout the customer was sent to").toContain(rows![0].stripe_checkout_session_id);
  expect(await data.spotsLeft(sessionId), "the 2 spots are held once").toBe(0);
});

test("a Service: the reply is lost, the customer presses again, one request", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  await data.hours(provider);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area());
  await signIn(context, customer.email, customer.password);

  await page.goto(`/services/${listing.slug}`);
  await page.getByRole("button", { name: "Check availability" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radiogroup", { name: /^Times on / }).locator("label").first().click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Your name").fill("Sam Customer");
  await dropFirstReply(page, "/api/bookings/service");
  const sentToStripe = await stopAtStripe(page);
  await dialog.getByRole("button", { name: "Request to book" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Checkout couldn't be started. Please try again.");

  await dialog.getByRole("button", { name: "Request to book" }).click();
  const stripeUrl = await sentToStripe();
  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  expect(rows, "exactly one request").toHaveLength(1);
  expect(stripeUrl).toContain(rows![0].stripe_checkout_session_id);
});

test("an Experience: after a lost reply the customer changes the details; the lost attempt ends", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const startsAt = daysFromNow(4);
  const sessionId = await data.session(listing.id, startsAt, 2);
  await signIn(context, customer.email, customer.password);

  await openExperience(page, listing.slug, startsAt);
  await page.getByLabel("How many people?").fill("2");
  await dropFirstReply(page, "/api/bookings/experience");
  const sentToStripe = await stopAtStripe(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("alert")).toHaveText("Checkout couldn't be started. Please try again.");

  // One person after all: a new attempt.
  await page.getByLabel("How many people?").fill("1");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const stripeUrl = await sentToStripe();

  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id).order("created_at");
  expect(rows!.map((r) => [r.party_size, r.status]), "the lost attempt ended; the new one waits for payment").toEqual([[2, "expired"], [1, "pending_payment"]]);
  expect(stripeUrl).toContain(rows![1].stripe_checkout_session_id);
  const lost = await data.env.stripe.checkout.sessions.retrieve(rows![0].stripe_checkout_session_id);
  expect(lost.status, "the lost attempt's Checkout is expired").toBe("expired");
  expect(await data.spotsLeft(sessionId), "only the new attempt holds a spot").toBe(1);
});
