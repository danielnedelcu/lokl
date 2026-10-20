import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 42: contact details only on request, and recorded (admin roles,
// step 5c). Support opens a booking: the customer's email isn't on the page
// until "Show contact details", which counts toward their daily limit. A
// provider owner's email is shown the same way on Providers. The owner sees
// both views on the Team page's record.

test("contact details are shown on request, counted, and recorded for the owner", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const support = await data.user("support", { admin: "support" });
  const customer = await data.user("customer");
  const providerOwner = await data.user("provider");
  const name = `E2E Contacts ${data.run}`;
  const provider = await data.provider(providerOwner, name);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const booking = await data.paidBooking(customer, await data.session(listing.id, daysFromNow(5)));

  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/bookings/${booking.id}`);
  await expect(page.getByRole("heading", { level: 1, name: listing.title })).toBeVisible();
  // Not on the page until asked for.
  await expect(page.getByText(customer.email)).toHaveCount(0);
  await expect(page.getByText(/Each view is recorded\. You've seen 0 of \d+ today\./)).toBeVisible();
  await page.getByRole("button", { name: "Show contact details" }).click();
  await expect(page.getByText(customer.email)).toBeVisible();
  // Counted toward today's limit.
  await page.reload();
  await expect(page.getByText(/You've seen 1 of \d+ today\./)).toBeVisible();

  // A provider owner's email, the same way.
  await page.goto(`${ADMIN}/providers?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(providerOwner.email)).toHaveCount(0);
  await page.getByRole("button", { name: `Show the owner's email for ${name}` }).click();
  await expect(page.getByText(providerOwner.email)).toBeVisible();

  // The owner sees both on the Team page's record.
  const theirs = await browser.newContext();
  await signIn(theirs, owner.email, owner.password, { app: "admin" });
  const ownerPage = await theirs.newPage();
  await ownerPage.goto(`${ADMIN}/team`);
  const record = ownerPage.getByRole("region", { name: "Contact details viewed" });
  await record.getByLabel("Who").selectOption({ label: support.email });
  await expect(record.getByRole("listitem").filter({ hasText: `${support.email} saw the customer's email and phone for Sam Customer's booking of “${listing.title}”` })).toBeVisible();
  await expect(record.getByRole("listitem").filter({ hasText: `${support.email} saw the owner's email for ${name}` })).toBeVisible();
  // The record names what was seen, never the details themselves.
  await expect(record.getByText(customer.email)).toHaveCount(0);
  await theirs.close();
});
