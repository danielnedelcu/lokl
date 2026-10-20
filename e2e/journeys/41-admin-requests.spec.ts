import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 41: support asks, the owner decides (admin roles, step 5b). A
// refund over the $150 limit becomes "Request a refund"; the owner approves
// it on Requests, Stripe refunds once, the booking's history names both,
// and support's bell says so. A refund within the limit stays direct.
// Support asks to suspend a provider; the owner declines with a note
// support sees. Support withdraws a request of their own.

test("support asks for a refund over the limit; the owner approves; the history names both", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const support = await data.user("support", { admin: "support" });
  const customer = await data.user("customer");
  const provider = await data.provider(await data.user("provider"));
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const session = await data.session(listing.id, daysFromNow(5), 8);
  const big = await data.paidBooking(customer, session, 4);
  const small = await data.paidBooking(customer, session, 2);

  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  // Within the limit ($100): direct.
  await page.goto(`${ADMIN}/bookings/${small.id}`);
  await expect(page.getByRole("button", { name: "Refund and cancel" })).toBeVisible();
  // Over it ($200): a request.
  await page.goto(`${ADMIN}/bookings/${big.id}`);
  await page.getByRole("button", { name: "Request a refund" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Ask the owner to refund $200.00 for “${listing.title}”`);
  await expect(dialog).toContainText("Nothing changes until they approve.");
  await dialog.getByLabel("Reason").fill("The venue flooded; the customer can't attend.");
  await dialog.getByRole("button", { name: "Send the request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Request sent to the owner." })).toBeVisible();
  await expect(page.getByText("Waiting for the owner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a refund" })).toBeDisabled();
  expect((await data.env.stripe.refunds.list({ payment_intent: big.pi })).data, "nothing refunded yet").toHaveLength(0);

  // The owner approves it on Requests.
  const theirs = await browser.newContext();
  await signIn(theirs, owner.email, owner.password, { app: "admin" });
  const ownerPage = await theirs.newPage();
  await ownerPage.goto(`${ADMIN}/requests`);
  const item = ownerPage.getByRole("listitem").filter({ hasText: `${support.email} asked to refund $200.00 for “${listing.title}”` });
  await expect(item).toContainText("“The venue flooded; the customer can't attend.”");
  await item.getByRole("button", { name: /^Approve/ }).click();
  const confirm = ownerPage.getByRole("alertdialog");
  await expect(confirm).toContainText("the customer refunded $200.00, what's left of the charge");
  await confirm.getByRole("button", { name: "Approve" }).click();
  await expect(ownerPage.getByRole("status").filter({ hasText: "Approved: cancelled and refunded." })).toBeVisible();
  expect((await data.env.stripe.refunds.list({ payment_intent: big.pi })).data, "refunded once").toHaveLength(1);
  // The booking's history names both.
  await ownerPage.goto(`${ADMIN}/bookings/${big.id}`);
  await expect(ownerPage.getByRole("listitem").filter({ hasText: "Cancelled by lokl" }))
    .toContainText(`asked by ${support.email}, approved by ${owner.email}`);
  await theirs.close();

  // Support's bell.
  await page.reload();
  await page.getByRole("button", { name: /notifications/i }).click();
  await expect(page.getByRole("list", { name: "Notifications, newest first" }))
    .toContainText(`The owner approved your request to refund $200.00 for “${listing.title}”`);
});

test("the owner declines a suspension request with a note; support withdraws another", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const support = await data.user("support", { admin: "support" });
  const customer = await data.user("customer");
  const name = `E2E Requests ${data.run}`;
  const provider = await data.provider(await data.user("provider"), name);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const big = await data.paidBooking(customer, await data.session(listing.id, daysFromNow(6), 8), 4);

  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/providers?q=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: `Request to suspend ${name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Ask the owner to suspend ${name}?`);
  await dialog.getByLabel("Reason (lokl only)").fill("Three no-shows this month.");
  await dialog.getByRole("button", { name: "Send the request" }).click();
  await expect(dialog).toBeHidden();

  // A refund request, then withdrawn.
  await page.goto(`${ADMIN}/bookings/${big.id}`);
  await page.getByRole("button", { name: "Request a refund" }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Customer asked; checking with the provider first.");
  await page.getByRole("dialog").getByRole("button", { name: "Send the request" }).click();
  await page.getByRole("button", { name: "Withdraw the request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Request withdrawn." })).toBeVisible();
  await expect(page.getByText("Waiting for the owner")).toHaveCount(0);

  // The owner declines the suspension.
  const theirs = await browser.newContext();
  await signIn(theirs, owner.email, owner.password, { app: "admin" });
  const ownerPage = await theirs.newPage();
  await ownerPage.goto(`${ADMIN}/requests`);
  const item = ownerPage.getByRole("listitem").filter({ hasText: `${support.email} asked to suspend ${name}` });
  await item.getByRole("button", { name: /^Decline/ }).click();
  await ownerPage.getByRole("dialog").getByLabel("Note to them").fill("Two were the customer's fault; let's talk first.");
  await ownerPage.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await expect(ownerPage.getByRole("status").filter({ hasText: "Declined." })).toBeVisible();
  expect((await data.env.db.from("providers").select("status").eq("id", provider).single()).data?.status).toBe("active");
  await theirs.close();

  // Support sees the decision and the note.
  await page.goto(`${ADMIN}/requests`);
  await page.getByRole("button", { name: "Decided" }).click();
  const decided = page.getByRole("listitem").filter({ hasText: `You asked to suspend ${name}` });
  await expect(decided).toContainText(`Declined by ${owner.email}`);
  await expect(decided).toContainText("Note: “Two were the customer's fault; let's talk first.”");
  await expect(page.getByRole("listitem").filter({ hasText: "You asked to refund $200.00" })).toContainText("Withdrawn");
});
