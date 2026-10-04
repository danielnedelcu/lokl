import type { Page } from "@playwright/test";
import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 8: provider profiles (docs/design/provider-profiles.md).

/** A plain image of the given size, made in the browser (PNG bytes). */
async function image(page: Page, width: number, height: number) {
  const bytes = await page.evaluate(async ([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w!;
    c.height = h!;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3a7";
    ctx.fillRect(0, 0, w!, h!);
    ctx.fillStyle = "#fff";
    ctx.fillRect(w! / 4, h! / 4, w! / 2, h! / 2);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return Array.from(new Uint8Array(await blob!.arrayBuffer()));
  }, [width, height]);
  return { name: "photo.png", mimeType: "image/png", buffer: Buffer.from(bytes) };
}

async function addPhoto(page: Page, area: string, file: Awaited<ReturnType<typeof image>>) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: area }).click();
  await (await chooser).setFiles(file);
  await page.getByRole("dialog").getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("a provider fills in their profile; visitors see it on the listing and the profile page", async ({ page, context, data }) => {
  test.setTimeout(180_000);
  const owner = await data.user("owner");
  const providerId = await data.provider(owner, `E2E Peach ${data.run}`);
  const category = await data.category("experience");
  const area = await data.area();
  const first = await data.listing(providerId, "experience", category.id, area);
  const second = await data.listing(providerId, "experience", category.id, area);
  await data.session(first.id, daysFromNow(4));
  const { data: row } = await data.env.db.from("providers").select("slug").eq("id", providerId).single();
  const slug = (row as { slug: string }).slug;

  // Settings: a headline that looks like a phone number is refused, with why.
  await signIn(context, owner.email, owner.password);
  await page.goto("/dashboard/settings");
  await page.getByLabel("Headline (optional)").fill("Tours 2015-2020");
  await page.getByLabel("About you (optional)").click();
  await expect(page.getByText("“2015-2020” looks like a phone number")).toBeVisible();
  await page.getByLabel("Headline (optional)").fill("Food walks through Atlanta's oldest neighborhoods");
  await page.getByLabel("About you (optional)").fill("We started our walks in 2019.\nSmall groups, good food.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Business profile saved.")).toBeVisible();

  // Photos: added, then the profile photo replaced (the old files go).
  await addPhoto(page, "Click to add a profile photo", await image(page, 700, 500));
  await expect(page.getByText("Profile photo saved.")).toBeVisible();
  await addPhoto(page, "Click to add a cover photo", await image(page, 1800, 700));
  await expect(page.getByText("Cover photo saved.")).toBeVisible();
  const files = async () => ((await data.env.db.storage.from("provider-photos").list(providerId)).data ?? []).map((f) => f.name);
  expect((await files()).length, "both photos and their copies").toBe(4);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Profile photo" }).getByRole("button", { name: "Replace" }).click();
  await (await chooser).setFiles(await image(page, 300, 300));
  await page.getByRole("dialog").getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Profile photo saved.").first()).toBeVisible();
  await expect.poll(async () => (await files()).length, { message: "the replaced photo's files are deleted" }).toBe(4);

  // A visitor, on the listing: the profile card and "More from".
  await context.clearCookies();
  await page.goto(`/experiences/${first.slug}`);
  const card = page.getByRole("region", { name: "Hosted by" });
  await expect(card).toContainText(`E2E Peach ${data.run}`);
  await expect(card).toContainText("Food walks through Atlanta's oldest neighborhoods");
  await expect(card).toContainText("Based in Atlanta");
  await expect(card).toContainText("On lokl since");
  const more = page.getByRole("region", { name: `More from E2E Peach ${data.run}` });
  await expect(more.getByRole("link", { name: second.title })).toBeVisible();

  // The profile page.
  await card.getByRole("link", { name: `View E2E Peach ${data.run}'s profile` }).click();
  await expect(page).toHaveURL(new RegExp(`/providers/${slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: `E2E Peach ${data.run}` })).toBeVisible();
  await expect(page.getByText("Small groups, good food.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Experiences (2)" })).toBeVisible();

  // Suspended: no public profile, once the page's one-minute cache has passed.
  await data.env.db.from("providers").update({ status: "suspended" }).eq("id", providerId);
  await expect.poll(async () => (await page.request.get(`/providers/${slug}`)).status(),
    { message: "a suspended provider's profile page is not found", timeout: 75_000, intervals: [5_000] }).toBe(404);
});

test("the admin removes profile content that breaks a rule, and the provider is emailed", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const owner = await data.user("owner");
  const providerId = await data.provider(owner, `E2E Rules ${data.run}`);
  await data.env.db.from("providers").update({ headline: "Walks and tastings", bio: "Ask for Sam at the gate." }).eq("id", providerId);
  await signIn(context, admin.email, admin.password);

  await page.goto(`${ADMIN}/providers?q=${encodeURIComponent(`E2E Rules ${data.run}`)}`);
  await page.getByRole("button", { name: `Profile of E2E Rules ${data.run}` }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Ask for Sam at the gate.");
  await sheet.getByRole("checkbox").nth(1).check(); // the about text (headline is first)
  await sheet.getByLabel("The rule it breaks").click();
  await page.getByRole("option", { name: /Anyone's private information/ }).click();
  await sheet.getByLabel("Reason (lokl only)").fill("A staff member's name in the bio.");
  await sheet.getByRole("button", { name: "Remove and email the provider" }).click();
  await expect(page.getByText(`Removed from E2E Rules ${data.run}'s profile.`)).toBeVisible();

  const { data: after } = await data.env.db.from("providers").select("headline, bio").eq("id", providerId).single();
  expect(after).toEqual({ headline: "Walks and tastings", bio: null });
  const { data: email } = await data.env.db.from("provider_emails").select("kind, rule, removed").eq("provider_id", providerId).single();
  expect(email).toEqual({ kind: "provider_profile_edited", rule: "private_information", removed: ["bio"] });
});
