import { atlantaDate, atlantaTime, daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, stopAtStripe, test } from "../support/fixtures";

// Journey 2: a customer requests a Service with preferred times, and the
// provider accepts one (the held card is charged) or declines (the hold is
// released).

test("request a Service: offer a time and go to payment", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("service");
  const listing = await data.listing(provider, "service", category.id, await data.area());
  await signIn(context, customer.email, customer.password);

  await page.goto(`/services/${listing.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: listing.title })).toBeVisible();

  // A date five days out, typed into the date field's month, day and year.
  const day = new Date(Date.now() + 5 * 864e5);
  const date = page.getByRole("group", { name: "Date" });
  await date.getByRole("spinbutton").first().click();
  await page.keyboard.type(
    `${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}${day.getFullYear()}`,
  );
  // 10:30 AM, from the three time dropdowns.
  for (const [label, value] of [["Hour", "10"], ["Minutes", "30"], ["AM or PM", "AM"]] as const) {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  await page.getByLabel("Your name").fill("Sam Customer");

  const sentToStripe = await stopAtStripe(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const stripeUrl = await sentToStripe();
  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  const pending = rows!.find((r) => r.status === "pending_payment")!;
  expect(pending, "a request waits for payment").toBeTruthy();
  expect(stripeUrl).toContain(pending.stripe_checkout_session_id);
  // The time offered is 10:30 AM in Atlanta, though the browser is in Los Angeles.
  expect(pending.preferred_times).toHaveLength(1);
  expect(atlantaTime(pending.preferred_times[0])).toBe("10:30 AM");
});

test("the provider accepts a requested time; another request is declined", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("service");
  const listing = await data.listing(provider, "service", category.id, await data.area());
  const first = daysFromNow(4);
  const second = daysFromNow(5);
  const request = await data.heldRequest(customer, listing.id, [first, second]);
  const other = await data.heldRequest(customer, listing.id, [first]);

  // The provider sees the request and accepts the second time.
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${request.id}`);
  await expect(page.getByText("Needs your answer", { exact: true })).toBeVisible();
  const secondTime = page.locator("label").filter({ hasText: atlantaDate(second) }).filter({ hasText: atlantaTime(second) });
  await secondTime.click();
  await page.getByRole("button", { name: "Accept this time" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect((await data.env.stripe.paymentIntents.retrieve(request.pi)).status, "the held card is charged").toBe("succeeded");
  expect(new Date((await data.booking(request.id)).starts_at).toISOString()).toBe(second);

  // The customer sees it confirmed, at the accepted time in Atlanta.
  await context.clearCookies();
  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${request.id}`);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(atlantaTime(second)).first()).toBeVisible();

  // The provider declines the other request: the hold is released.
  await context.clearCookies();
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${other.id}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByText("Declined", { exact: true })).toBeVisible();
  expect((await data.env.stripe.paymentIntents.retrieve(other.pi)).status, "the hold is released").toBe("canceled");
});
