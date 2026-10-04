import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";
import { ADMIN } from "../support/env";

// Journey 4: after a booking has happened, the pay-out job pays the provider
// (a real test transfer to the sandbox's connected account); the provider
// and the admin both see it as paid out.

test("a booking that has happened is paid out to the provider", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  const booking = await data.paidBooking(customer, await data.session(listing.id, daysFromNow(4)));

  // It happened yesterday and its payout is due; the scheduler's job runs.
  data.endedAndDue(booking.id);
  await data.job("pay-out");
  const row = await data.booking(booking.id);
  expect(row.status).toBe("paid_out");
  const transfer = await data.env.stripe.transfers.retrieve(row.stripe_transfer_id);
  expect(transfer.destination, "paid to the provider's connected account").toBe(data.env.connectedAccount);
  expect(transfer.amount, "the provider's share").toBe(row.provider_amount_cents);

  // The provider sees it paid out.
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${booking.id}`);
  await expect(page.getByText("Paid out", { exact: true })).toBeVisible();

  // So does the admin, in the admin app.
  await context.clearCookies();
  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/bookings/${booking.id}`);
  await expect(page.getByText("Paid out", { exact: true }).first()).toBeVisible();
});
