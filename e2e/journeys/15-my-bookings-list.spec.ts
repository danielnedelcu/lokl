import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 15: the customer's My bookings counts each group in full and pages
// it, 20 at a time (server/utils/customerBookingList.ts).

test("past bookings are counted and come 20 at a time", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  for (let i = 0; i < 21; i++) await data.completedBooking(customer, listing.id, { endedDaysAgo: 2 + i });

  await signIn(context, customer.email, customer.password);
  await page.goto("/account/bookings");
  await expect(page.getByRole("heading", { name: "Past (21)" })).toBeVisible();
  const past = page.locator('[data-booking="past"]');
  await expect(past).toHaveCount(20);
  await page.getByRole("button", { name: "Show more past bookings" }).click();
  await expect(past).toHaveCount(21);
  await expect(past.nth(20)).toBeFocused();
  await expect(page.getByRole("button", { name: "Show more past bookings" })).toHaveCount(0);
});
