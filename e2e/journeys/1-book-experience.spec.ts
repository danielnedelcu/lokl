import { atlantaDate, atlantaTime, daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, stopAtStripe, test } from "../support/fixtures";

// Journey 1: a customer books an Experience. Runs at desktop and phone size.
// The browser is in Los Angeles time; every time shown must be Atlanta's.

test("book an Experience: browse, choose a date, go to payment, come back; a paid booking shows as confirmed @phone", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  const startsAt = daysFromNow(4);
  const sessionId = await data.session(listing.id, startsAt, 4);
  await signIn(context, customer.email, customer.password);

  // Browse to the listing through its category.
  await page.goto(`/atlanta/experiences/${category.slug}`);
  await page.getByRole("link", { name: listing.title }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: listing.title })).toBeVisible();

  // The date is shown in Atlanta time, though the browser is in Los Angeles.
  const sessionOption = page.locator("label").filter({ hasText: atlantaDate(startsAt) }).filter({ hasText: atlantaTime(startsAt) });
  await expect(sessionOption).toBeVisible();
  await sessionOption.click();
  await page.getByLabel("Your name").fill("Sam Customer");

  // Continue to payment: the browser is sent to Stripe for this booking.
  const sentToStripe = await stopAtStripe(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const stripeUrl = await sentToStripe();
  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  const pending = rows!.find((r) => r.status === "pending_payment")!;
  expect(pending, "a booking waits for payment").toBeTruthy();
  expect(stripeUrl).toContain(pending.stripe_checkout_session_id);
  expect(await data.spotsLeft(sessionId), "the spot is held while paying").toBe(3);

  // Back from Stripe without paying: the hold is released.
  await page.goto(`/experiences/${listing.slug}?checkout=cancelled&booking=${pending.id}`);
  await expect.poll(async () => (await data.booking(pending.id)).status, { message: "the abandoned booking ends" }).toBe("expired");
  await expect.poll(() => data.spotsLeft(sessionId), { message: "the spot is free again" }).toBe(4);

  // A paid booking (paid through Stripe's API) shows as confirmed, in Atlanta time.
  const paid = await data.paidBooking(customer, sessionId);
  await page.goto(`/account/bookings/${paid.id}`);
  await expect(page.getByRole("heading", { level: 1, name: listing.title })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(atlantaTime(startsAt)).first()).toBeVisible();
  await expect(page.getByText("$50.00").first()).toBeVisible();
});
