import { choose } from "../support/forms";
import { signIn } from "../support/auth";
import { ADMIN, WEBSITE } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 44: support hides profile content, the owner decides (admin roles
// step 5e). Support hides a provider's profile photo and about text: both
// leave the public profile, and the photo's address stops working. The
// provider sees what's hidden on their profile page; the owner is alerted,
// restores the photo (back at its address) and confirms the bio's removal.
// The provider's page in the admin app keeps each step.

test("support hides a photo and a bio; the owner restores one and confirms the other", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const support = await data.user("support", { admin: "support" });
  const providerOwner = await data.user("provider");
  const name = `E2E Hidden ${data.run}`;
  const provider = await data.provider(providerOwner, name);
  await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const avatar = [`${provider}/avatar-${data.run}.webp`, `${provider}/avatar-${data.run}-small.webp`];
  for (const p of avatar) {
    const { error } = await data.env.db.storage.from("provider-photos").upload(p, Buffer.from(`webp ${p}`), { contentType: "image/webp", cacheControl: "300" });
    if (error) throw new Error(error.message);
  }
  const { data: row } = await data.env.db.from("providers")
    .update({ avatar_path: avatar[0], avatar_small_path: avatar[1], bio: "Ask for Sam, our guide, at the gate." }).eq("id", provider).select("slug").single();
  const slug = row!.slug as string;
  const photoUrl = `${data.env.apiUrl}/storage/v1/object/public/provider-photos/${avatar[0]}`;
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  expect((await visitorPage.request.get(photoUrl)).ok()).toBe(true);

  // Support hides both.
  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/providers/${provider}`);
  await page.getByRole("button", { name: "Profile" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Ask for Sam, our guide, at the gate.");
  await expect(sheet.getByText("Remove it now")).toHaveCount(0);
  await sheet.getByRole("checkbox", { name: "Profile photo" }).check();
  await sheet.getByRole("checkbox", { name: "About text (bio)" }).check();
  await choose(page, sheet.getByLabel("The rule it breaks"), /Anyone's private information/);
  await sheet.getByLabel("Reason (lokl only)").fill("A staff member named, and a photo of them.");
  await sheet.getByRole("button", { name: "Hide and email the provider" }).click();
  await expect(page.getByText(`Hidden from ${name}'s profile.`)).toBeVisible();

  // Off the public profile at once; the photo's address no longer works.
  await expect.poll(async () => (await visitorPage.request.get(photoUrl)).ok()).toBe(false);
  await expect.poll(async () => {
    await visitorPage.goto(`${WEBSITE}/providers/${slug}`);
    return visitorPage.getByText("Ask for Sam, our guide, at the gate.").count();
  }, { timeout: 5000 }).toBe(0);

  // The provider sees what's hidden, and why in the rule's words.
  const theirs = await browser.newContext();
  await signIn(theirs, providerOwner.email, providerOwner.password);
  const providerPage = await theirs.newPage();
  await providerPage.goto(`${WEBSITE}/dashboard/settings`);
  await expect(providerPage.getByText("lokl has hidden your profile photo while it reviews it")).toBeVisible();
  await expect(providerPage.getByText("lokl has hidden your \"About you\" text while it reviews it")).toBeVisible();
  await expect(providerPage.getByText("A staff member named")).toHaveCount(0);

  // The owner: alerted, then decides each.
  const ownerContext = await browser.newContext();
  await signIn(ownerContext, owner.email, owner.password, { app: "admin" });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(ADMIN);
  await ownerPage.getByRole("button", { name: /notifications/i }).click();
  await ownerPage.getByRole("list", { name: "Notifications, newest first" })
    .getByText(`${support.email} hid the profile photo and about text of ${name}.`).click();
  await expect(ownerPage).toHaveURL(`${ADMIN}/requests`);
  const photoItem = ownerPage.getByRole("listitem", { name: `${name}: Profile photo` });
  await expect(photoItem).toContainText("Reason: “A staff member named, and a photo of them.”");
  await photoItem.getByRole("button", { name: "Restore" }).click();
  await ownerPage.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
  await expect(ownerPage.getByText("Restored. They've been emailed.")).toBeVisible();
  const bioItem = ownerPage.getByRole("listitem", { name: `${name}: About text (bio)` });
  await bioItem.getByRole("button", { name: "Confirm removal" }).click();
  const confirm = ownerPage.getByRole("dialog");
  await confirm.getByLabel("Note (lokl only, optional)").fill("Names a member of staff.");
  await confirm.getByRole("button", { name: "Confirm removal" }).click();
  await expect(ownerPage.getByText("Removed. They've been emailed.")).toBeVisible();

  // The photo is back at its address; the bio stays gone.
  await expect.poll(async () => (await visitorPage.request.get(photoUrl)).ok()).toBe(true);
  const { data: after } = await data.env.db.from("providers").select("avatar_path, bio").eq("id", provider).single();
  expect(after).toEqual({ avatar_path: avatar[0], bio: null });
  const { data: emails } = await data.env.db.from("provider_emails").select("kind").eq("provider_id", provider);
  expect((emails ?? []).map((e) => e.kind).sort()).toEqual(["provider_profile_edited", "provider_profile_hidden", "provider_profile_restored"]);

  // The provider's page keeps each step, with who and why.
  await ownerPage.goto(`${ADMIN}/providers/${provider}`);
  const history = ownerPage.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem").filter({ hasText: `${support.email} hid part of a provider's profile` }))
    .toContainText("Reason: “A staff member named, and a photo of them.”");
  await expect(history.getByRole("listitem").filter({ hasText: "You restored part of a provider's profile" })).toHaveCount(1);
  await expect(history.getByRole("listitem").filter({ hasText: "You confirmed removing part of a provider's profile" }))
    .toContainText("Reason: “Names a member of staff.”");
  await visitor.close();
  await theirs.close();
  await ownerContext.close();
});
