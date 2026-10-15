import type { Page } from "@playwright/test";
import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 20: the reply to a money action is lost after the server has done
// it (a dropped connection): accepting a request, a customer's cancellation,
// cancelling a session, and lokl's refund. The page checks where things
// stand and says it's done, never "please try again" for something that
// went through (isLostReply, in the shared layer); pressing again answers
// success; and the money moved once (the lost-reply check, 2026-10-11).

/** Lets the first request to `path` reach the server, then drops its reply. */
async function dropFirstReply(page: Page, path: string) {
  let dropped = false;
  await page.route(`**${path}`, async (route) => {
    if (dropped || route.request().method() !== "POST") return route.continue();
    dropped = true;
    await route.fetch(); // the server does it
    await route.abort("connectionreset"); // the browser never hears back
  });
}

/** Sends the same request again from the page (the person's own sign-in), as a retry would. */
async function again(page: Page, path: string, body: Record<string, unknown> = {}) {
  return page.evaluate(async ({ path, body }) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }, { path, body });
}

const refundsOf = async (data: { env: { stripe: import("stripe").default } }, pi: string) =>
  (await data.env.stripe.refunds.list({ payment_intent: pi })).data.filter((r) => r.status !== "failed" && r.status !== "canceled");

test("accepting a request: the reply is lost, the page says it's accepted", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area());
  await data.hours(provider);
  const request = await data.heldRequest(customer, listing.id);

  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${request.id}`);
  await dropFirstReply(page, `/api/bookings/${request.id}/accept`);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Accepted. The customer's card was charged.")).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(/try again/i)).toHaveCount(0);

  const retry = await again(page, `/api/bookings/${request.id}/accept`, {});
  expect(retry, "pressing again answers success").toEqual({ status: 200, body: { result: "already accepted" } });
  const pi = await data.env.stripe.paymentIntents.retrieve(request.pi);
  expect([pi.status, pi.amount_received], "charged once").toEqual(["succeeded", pi.amount]);
});

test("a customer's cancellation: the reply is lost, the page says it's cancelled", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const booking = await data.paidBooking(customer, await data.session(listing.id, daysFromNow(4)));

  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${booking.id}`);
  await dropFirstReply(page, `/api/bookings/${booking.id}/cancel`);
  await page.getByRole("button", { name: /^Cancel (booking|request)$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel it" }).click();
  await expect(page.getByText("Your booking is cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText(/try again/i)).toHaveCount(0);

  const retry = await again(page, `/api/bookings/${booking.id}/cancel`);
  expect(retry, "pressing again answers success").toEqual({ status: 200, body: { result: "already cancelled" } });
  expect((await refundsOf(data, booking.pi)).map((r) => r.amount), "refunded once, in full").toEqual([5000]);
});

test("cancelling a session: the reply is lost, the page says it's cancelled", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const sessionId = await data.session(listing.id, daysFromNow(4));
  const one = await data.paidBooking(customer, sessionId);
  const two = await data.paidBooking(customer, sessionId);

  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/listings/${listing.id}`);
  await dropFirstReply(page, `/api/sessions/${sessionId}/cancel`);
  await page.getByRole("button", { name: /^Cancel the session on / }).click();
  await page.getByLabel("Why are you cancelling?").fill("The venue closed for the day.");
  await page.getByRole("button", { name: "Cancel and refund everyone" }).click();
  await expect(page.getByText("Session cancelled. Everyone booked is refunded in full.")).toBeVisible();
  await expect(page.getByText(/try again/i)).toHaveCount(0);

  const retry = await again(page, `/api/sessions/${sessionId}/cancel`, { reason: "The venue closed for the day." });
  expect(retry.status, "pressing again answers success").toBe(200);
  for (const b of [one, two]) {
    expect((await data.booking(b.id)).status).toBe("cancelled");
    expect((await refundsOf(data, b.pi)).map((r) => r.amount), "each refunded once, in full").toEqual([5000]);
  }
});

test("lokl's refund: the reply is lost, the admin page says it's done, logged once", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const booking = await data.paidBooking(customer, await data.session(listing.id, daysFromNow(4)));

  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/bookings/${booking.id}`);
  await dropFirstReply(page, `/api/admin/bookings/${booking.id}/cancel`);
  await page.getByRole("button", { name: "Refund and cancel" }).click();
  await page.getByLabel("Reason").fill("The provider asked us to cancel.");
  await page.getByRole("dialog").or(page.getByRole("alertdialog")).getByRole("button", { name: "Refund and cancel" }).click();
  await expect(page.getByText("Done.", { exact: true })).toBeVisible();
  await expect(page.getByText(/try again/i)).toHaveCount(0);

  const b = await data.booking(booking.id);
  expect([b.status, b.cancelled_by]).toEqual(["cancelled", "admin"]);
  expect((await refundsOf(data, booking.pi)).map((r) => r.amount), "refunded once, in full").toEqual([5000]);
  const { count } = await data.env.db.from("admin_actions").select("id", { count: "exact", head: true }).eq("target_id", booking.id);
  expect(count, "logged once").toBe(1);
});
