import { atlantaDate, atlantaTime } from "../support/data";
import { signIn } from "../support/auth";
import { expect, stopAtStripe, test } from "../support/fixtures";
import type { Page } from "@playwright/test";

// Journey 2: a customer books a Service from its free times
// (docs/design/service-availability.md): Instant ones are paid at once;
// for the rest the card is held and the provider accepts or declines. The
// browser is in Los Angeles time; every time shown must be Atlanta's.

/** Opens the scheduling panel from the listing page, by keyboard. */
async function openPanel(page: Page, slug: string, title: string) {
  await page.goto(`/services/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("Next available:")).toBeVisible();
  const open = page.getByRole("button", { name: "Check availability" });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Schedule your ${title}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("book an Instant Service by keyboard: a day, a time, details, then payment @phone @zones", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  await data.hours(provider);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area(), undefined, "instant");
  await signIn(context, customer.email, customer.password);

  const dialog = await openPanel(page, listing.slug, listing.title);
  // On a phone the panel fills the screen.
  const viewport = page.viewportSize()!;
  // (Measured once its opening animation has finished.)
  if (viewport.width < 640) await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(viewport.width - 1);

  // The first day with times is chosen, and says how many it has.
  const chosenDay = dialog.getByRole("button", { pressed: true });
  await expect(chosenDay).toHaveAccessibleName(/, \d+ times$/);
  // Times are Atlanta's, and the group says so.
  const times = dialog.getByRole("radiogroup", { name: /^Times on .+, Atlanta time \(ET\)$/ });
  await expect(times.getByRole("radio").first()).toBeVisible();
  // Arrow keys choose, all four in the grid: Right to the third time, Left
  // back to the second, Down to the third, Up to the second.
  await times.getByRole("radio").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(times.getByRole("radio").nth(2)).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(times.getByRole("radio").nth(1)).toBeChecked();
  await expect(times.getByRole("radio").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(times.getByRole("radio").nth(2)).toBeChecked();
  await page.keyboard.press("ArrowUp");
  const second = times.getByRole("radio").nth(1);
  await expect(second).toBeChecked();
  await expect(second).toBeFocused();
  const label = (await times.locator("label").nth(1).innerText()).trim();
  await expect(dialog.getByText(/\(Atlanta time\) · \$50\.00$/).first()).toBeVisible();
  await expect(dialog.getByText("Your card is held")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("heading", { name: /\(Atlanta time\) · \$50\.00$/ })).toBeFocused();
  await dialog.getByLabel("Your name").fill("Sam Customer");
  const sentToStripe = await stopAtStripe(page);
  await dialog.getByRole("button", { name: "Book and pay" }).click();
  const stripeUrl = await sentToStripe();

  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  expect(rows, "one booking").toHaveLength(1);
  const pending = rows![0];
  expect([pending.status, pending.service_mode]).toEqual(["pending_payment", "instant"]);
  expect(stripeUrl).toContain(pending.stripe_checkout_session_id);
  // The time booked is the one shown, in Atlanta, though the browser is in Los Angeles.
  expect(atlantaTime(pending.starts_at)).toBe(label);
});

test("request an Approve Service; a time taken meanwhile sends the customer back to pick another", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const someoneElse = await data.user("other-customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  await data.hours(provider);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area());
  await signIn(context, customer.email, customer.password);

  const dialog = await openPanel(page, listing.slug, listing.title);
  const times = dialog.getByRole("radiogroup", { name: /^Times on / });
  await times.locator("label").first().click();
  const held = dialog.getByText("Your card is held, not charged, until").first();
  await expect(held).toBeVisible();
  await expect(held).toContainText(/accepts\. They answer by .+\(Atlanta time\)\./);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByLabel("Your name").fill("Sam Customer");

  // Someone else books that time first.
  const { data: slots } = await data.env.db.rpc("service_slots", {
    p_listing_id: listing.id,
    p_from: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()),
    p_to: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + 7 * 864e5)),
  });
  const first = (slots as { starts_at: string }[])[0]!.starts_at;
  await data.heldRequest(someoneElse, listing.id, new Date(first).toISOString());

  await dialog.getByRole("button", { name: "Request to book" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That time was just taken. Pick another.");
  await expect(times.locator("label").first()).not.toHaveText(atlantaTime(first));
  // Another time goes through.
  await times.locator("label").first().click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  const sentToStripe = await stopAtStripe(page);
  await dialog.getByRole("button", { name: "Request to book" }).click();
  await sentToStripe();
  const { data: rows } = await data.env.db.schema("private").from("booking_records").select("*").eq("customer_id", customer.id);
  expect(rows!.map((r) => [r.status, r.service_mode])).toEqual([["pending_payment", "approve"]]);
  expect(Date.parse(rows![0].starts_at)).not.toBe(Date.parse(first));
});

test("a Service with no hours yet says it isn't taking bookings, with nothing to press", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area(), undefined, "instant");

  // Signed out: no "Sign in to book" either.
  await page.goto(`/services/${listing.slug}`);
  await expect(page.getByText("Not taking bookings yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check availability" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in to book" })).toHaveCount(0);

  await signIn(context, customer.email, customer.password);
  await page.reload();
  await expect(page.getByText("Not taking bookings yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check availability" })).toHaveCount(0);

  // Hours added: bookable.
  await data.hours(provider);
  await page.reload();
  await expect(page.getByRole("button", { name: "Check availability" })).toBeVisible();
  await expect(page.getByText("Not taking bookings yet")).toHaveCount(0);
});

test("the provider accepts a request; another is declined, and shows as not having happened", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  await data.hours(provider);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area());
  const request = await data.heldRequest(customer, listing.id);
  const other = await data.heldRequest(customer, listing.id);

  // The provider sees the request's time, in Atlanta, and accepts it.
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${request.id}`);
  await expect(page.getByText("Needs your answer", { exact: true })).toBeVisible();
  const answer = page.getByRole("region", { name: "Accept or decline this request" });
  await expect(answer).toContainText(`${atlantaDate(request.startsAt)}, ${atlantaTime(request.startsAt)}`);
  await expect(answer).toContainText("Atlanta time");
  await answer.getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect((await data.env.stripe.paymentIntents.retrieve(request.pi)).status, "the held card is charged").toBe("succeeded");
  expect(new Date((await data.booking(request.id)).starts_at).toISOString(), "the time booked doesn't change").toBe(request.startsAt);

  // The provider declines the other: the hold is released.
  await page.goto(`/dashboard/bookings/${other.id}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByText("This didn't take place.")).toBeVisible();
  expect((await data.env.stripe.paymentIntents.retrieve(other.pi)).status, "the hold is released").toBe("canceled");
  // In the past list it leads with "Declined", not the time.
  await page.goto("/dashboard/bookings");
  await page.getByRole("tab", { name: /^Past/ }).click();
  await expect(page.getByText(`Declined · was requested for ${atlantaDate(other.startsAt)}, ${atlantaTime(other.startsAt)}`)).toBeVisible();

  // The customer: one confirmed at its time, one declined that never took place.
  await context.clearCookies();
  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${request.id}`);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(atlantaTime(request.startsAt)).first()).toBeVisible();
  await page.goto("/account/bookings");
  await expect(page.getByText(`Declined · you asked for ${atlantaDate(other.startsAt)}, ${atlantaTime(other.startsAt)}`)).toBeVisible();
  await page.goto(`/account/bookings/${other.id}`);
  await expect(page.getByText("This didn't take place.")).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^When$/ })).toHaveCount(0);
  await expect(page.locator("dt").filter({ hasText: /^You asked for$/ })).toBeVisible();
});
