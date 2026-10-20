import { execFileSync } from "node:child_process";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 43: listing review, support's limits and the Activity page (admin
// roles, step 5d). Support takes a live listing down: the owner's bell says
// so, and anyone on the team can put it back. The owner changes support's
// limits with a reason: the other owners are told what changed, and the
// Activity page keeps the reason. Support's Activity shows only their own.

test("support takes a listing down, the owner is told and restores it; Activity shows each their own", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const support = await data.user("support", { admin: "support" });
  const providerOwner = await data.user("provider");
  const provider = await data.provider(providerOwner, `E2E Review ${data.run}`);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());

  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/listings/${listing.id}`);
  await expect(page.getByRole("heading", { level: 1, name: listing.title })).toBeVisible();
  await page.getByRole("button", { name: "Take down" }).click();
  const dialog = page.getByRole("dialog", { name: "Take this listing down?" });
  await expect(dialog).toContainText("The owners are told.");
  await dialog.getByLabel(/reason/i).fill("The photos show another business.");
  await dialog.getByRole("button", { name: "Take down" }).click();
  await expect(page.getByText("Taken down.")).toBeVisible();

  // The owner's bell, then the listing back up.
  const theirs = await browser.newContext();
  await signIn(theirs, owner.email, owner.password, { app: "admin" });
  const ownerPage = await theirs.newPage();
  await ownerPage.goto(ADMIN);
  await ownerPage.getByRole("button", { name: /notifications/i }).click();
  await ownerPage.getByRole("list", { name: "Notifications, newest first" })
    .getByText(`${support.email} took down “${listing.title}”.`).click();
  await expect(ownerPage).toHaveURL(`${ADMIN}/listings/${listing.id}`);
  await ownerPage.getByRole("button", { name: "Restore" }).click();
  await ownerPage.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
  await expect(ownerPage.getByText("Restored. It's live again.")).toBeVisible();

  // The owner's Activity: everyone's, or one person's, with the reason.
  await ownerPage.goto(`${ADMIN}/activity`);
  await ownerPage.getByLabel("Who").selectOption({ label: support.email });
  const entries = ownerPage.getByRole("listitem");
  await expect(entries.filter({ hasText: `${support.email} took a listing down` }))
    .toContainText("Reason: “The photos show another business.”");
  await ownerPage.getByLabel("Who").selectOption({ label: owner.email });
  await expect(entries.filter({ hasText: "You restored a listing" })).toHaveCount(1);
  await theirs.close();

  // Support's Activity: their own only, and no choice of person.
  await page.goto(`${ADMIN}/activity`);
  await expect(page.getByLabel("Who")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "You took a listing down" })).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: "restored a listing" })).toHaveCount(0);
});

// Support's limits are one row for the whole site, so this runs alone and
// puts them back afterwards.
test("the owner changes support's limits with a reason; the other owners are told", { tag: "@serial" }, async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const other = await data.user("owner2", { admin: true });
  const before = execFileSync("psql", [data.env.dbUrl, "-qAt", "-c", "select support_contact_views_per_day from public.admin_settings"], { encoding: "utf8" }).trim();
  try {
    await signIn(context, owner.email, owner.password, { app: "admin" });
    const page = await context.newPage();
    await page.goto(`${ADMIN}/settings`);
    const limits = page.getByRole("region", { name: "Support's limits" });
    const views = limits.getByLabel("Contact details seen a day");
    await views.fill(String(Number(before) - 1));
    await views.blur();
    await limits.getByLabel("Why you're changing them").fill("Fewer lookups while we review access.");
    await limits.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Support's limits saved. The other owners are told.")).toBeVisible();

    const theirs = await browser.newContext();
    await signIn(theirs, other.email, other.password, { app: "admin" });
    const otherPage = await theirs.newPage();
    await otherPage.goto(ADMIN);
    await otherPage.getByRole("button", { name: /notifications/i }).click();
    await expect(otherPage.getByRole("list", { name: "Notifications, newest first" }))
      .toContainText(`${owner.email} changed the settings: Contact views a day ${before} to ${Number(before) - 1}.`);
    await otherPage.goto(`${ADMIN}/activity`);
    await otherPage.getByLabel("Who").selectOption({ label: owner.email });
    await expect(otherPage.getByRole("listitem").filter({ hasText: "changed support's limits" }))
      .toContainText("Reason: “Fewer lookups while we review access.”");
    await theirs.close();
  } finally {
    execFileSync("psql", [data.env.dbUrl, "-q", "-c", `update public.admin_settings set support_contact_views_per_day = ${Number(before)}`]);
  }
});
