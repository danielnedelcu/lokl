import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 12: the provider's bookings list. Each tab is counted and paged by
// the database (server/utils/providerBookingList.ts), 20 at a time, with
// "Show more bookings" moving focus to the first new one.

test("the bookings tabs count everything and show more on request", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const area = await data.area();
  const experience = await data.listing(provider, "experience", (await data.category("experience")).id, area);
  const service = await data.listing(provider, "service", (await data.category("service")).id, area);

  await data.paidBooking(customer, await data.session(experience.id, daysFromNow(6)));
  for (let i = 0; i < 21; i++) await data.completedBooking(customer, experience.id, { endedDaysAgo: 2 + i });
  // Last: the request takes a time the sessions above left free.
  await data.hours(provider);
  await data.heldRequest(customer, service.id);

  await signIn(context, owner.email, owner.password);
  await page.goto("/dashboard/bookings");
  await expect(page.getByRole("tab", { name: "Requests (1)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Upcoming (1)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Past (21)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Answer this request" })).toHaveCount(1);

  await page.getByRole("tab", { name: "Upcoming (1)" }).click();
  await expect(page.getByRole("link", { name: "See details" })).toHaveCount(1);

  await page.getByRole("tab", { name: "Past (21)" }).click();
  const past = page.getByRole("tabpanel").getByRole("listitem");
  await expect(past).toHaveCount(20);
  await page.getByRole("button", { name: "Show more bookings" }).click();
  await expect(past).toHaveCount(21);
  await expect(past.nth(20)).toBeFocused();
  await expect(page.getByRole("button", { name: "Show more bookings" })).toHaveCount(0);
});
