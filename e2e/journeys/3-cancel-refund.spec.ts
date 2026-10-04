import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 3: cancelling with a refund, by the customer (more than 48 hours
// ahead: a full refund) and by the provider (always a full refund).

test("the customer and the provider each cancel a booking, and the card is refunded", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  const sessionId = await data.session(listing.id, daysFromNow(4));
  const mine = await data.paidBooking(customer, sessionId);
  const theirs = await data.paidBooking(customer, sessionId);
  const refundedOf = async (pi: string) =>
    (await data.env.stripe.refunds.list({ payment_intent: pi })).data.reduce((n, r) => n + (r.status === "failed" ? 0 : r.amount), 0);

  // The customer cancels: the dialog says it's a full refund.
  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${mine.id}`);
  await page.getByRole("button", { name: /^Cancel (booking|request)$/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("$50.00");
  await dialog.getByRole("button", { name: "Cancel it" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText(/\$50\.00 was refunded to your card/)).toBeVisible();
  expect(await refundedOf(mine.pi), "Stripe refunded the whole amount").toBe(5000);

  // The provider cancels the other one, with a reason.
  await context.clearCookies();
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${theirs.id}`);
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.getByLabel(/why are you cancelling/i).fill("The guide is unwell that day.");
  await page.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(await refundedOf(theirs.pi), "Stripe refunded the whole amount").toBe(5000);
  expect((await data.booking(theirs.id)).cancel_reason).toBe("The guide is unwell that day.");
});
