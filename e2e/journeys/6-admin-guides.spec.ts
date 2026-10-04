import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 6: the admin's guides (found 2026-10-04): deleting from the list
// really deletes; an empty new guide is discarded when it's left, and one
// left behind by a closed tab is removed from the list later; the photo
// upload area opens the file picker.

// A 1×1 PNG: enough to open the photo details.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("delete a draft guide from the list", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const title = `E2E delete me ${data.run}`;
  const { id } = await data.guide({ title });
  await signIn(context, admin.email, admin.password);

  await page.goto(`${ADMIN}/content?q=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: `Delete post: ${title}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete guide" }).click();
  await expect(page.getByText(`Deleted “${title}”.`)).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(await data.guideExists(id), "the guide is gone from the database").toBe(false);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
});

test("an empty new guide is discarded on leaving; one with a title stays", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  await signIn(context, admin.email, admin.password);

  // New guide, then straight back: nothing is kept.
  await page.goto(`${ADMIN}/content`);
  await page.getByRole("button", { name: /New guide/ }).click();
  const atlanta = page.getByRole("menuitem", { name: "Atlanta" });
  if (await atlanta.isVisible().catch(() => false)) await atlanta.click();
  await page.waitForURL(/\/content\/[0-9a-f-]{36}$/);
  const emptyId = page.url().split("/").pop()!;
  data.trackGuide(emptyId);
  await page.getByRole("link", { name: "All guides" }).click();
  await expect(page.getByText("The empty guide was discarded.")).toBeVisible();
  expect(await data.guideExists(emptyId), "the empty guide is gone").toBe(false);

  // New guide with a title typed: it's kept.
  await page.getByRole("button", { name: /New guide/ }).click();
  if (await atlanta.isVisible().catch(() => false)) await atlanta.click();
  await page.waitForURL(/\/content\/[0-9a-f-]{36}$/);
  const keptId = page.url().split("/").pop()!;
  data.trackGuide(keptId);
  await page.getByLabel("Title").fill(`E2E kept ${data.run}`);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "All guides" }).click();
  await expect(page).toHaveURL(/\/content$/);
  expect(await data.guideExists(keptId), "a guide with a title stays").toBe(true);
});

test("an empty draft left by a closed tab is removed from the list after an hour", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const old = await data.guide({ updatedHoursAgo: 2 });
  const recent = await data.guide();
  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content`);
  await expect.poll(() => data.guideExists(old.id), { message: "the hour-old empty draft is removed" }).toBe(false);
  expect(await data.guideExists(recent.id), "a new empty draft (maybe open in another tab) is kept").toBe(true);
});

test("the photo upload area opens the file picker", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const { id } = await data.guide({ title: `E2E photos ${data.run}` });
  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content/${id}`);
  await page.getByRole("button", { name: "Guide settings" }).click();
  const area = page.getByRole("button", { name: "Click to add photos" });
  await expect(area).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await area.click();
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("dialog", { name: "Add this photo" })).toBeVisible();
});
