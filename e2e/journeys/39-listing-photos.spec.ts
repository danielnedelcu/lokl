import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";
import type { Page } from "@playwright/test";

// Journey 39: adding several photos to a listing at once, each described in
// turn. Found 2026-10-18 (docs/frontend.md, confirmation dialogs): closing
// the "Describe this photo" dialog while a photo was uploading moved on to
// the next photo, and then the finished upload closed that one too, so it
// was dropped without a word.

/** A small PNG, drawn in the page, as a file to choose. */
async function png(page: Page, name: string, colour: string) {
  const base64 = await page.evaluate((c) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 320, 240);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, colour);
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

test("closing the photo dialog during an upload keeps the next photo", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const count = async () => (await data.env.db.from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listing.id)).count;
  const before = await count();
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/listings/${listing.id}`);

  // The first photo's upload is held until the test lets it go.
  let release: () => void = () => {};
  const released = new Promise<void>((r) => { release = r; });
  let reached: () => void = () => {};
  const uploading = new Promise<void>((r) => { reached = r; });
  let held = false;
  await page.route("**/storage/v1/object/listing-photos/**", async (route) => {
    if (held || route.request().method() !== "POST") return route.continue();
    held = true;
    reached();
    await released;
    await route.continue();
  });

  await page.locator('input[type="file"]').setInputFiles([await png(page, "red.png", "#c00"), await png(page, "blue.png", "#00c")]);
  const dialog = page.getByRole("dialog", { name: "Describe this photo" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("What's in the photo?").fill("A red square, the first photo.");
  await dialog.getByRole("button", { name: "Add photo" }).click();
  await uploading;
  // Closed while the first is still uploading: the second photo's dialog opens.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("What's in the photo?")).toHaveValue("");
  release();
  await expect(page.getByText("Photo added.").first()).toBeVisible();
  // Once the first upload has finished (its button no longer "Adding…"),
  // the second photo is still waiting to be described, not dropped.
  await expect(dialog.getByRole("button", { name: "Add photo" })).toBeEnabled();
  await expect(dialog.getByLabel("What's in the photo?")).toHaveValue("");
  await dialog.getByLabel("What's in the photo?").fill("A blue square, the second photo.");
  await dialog.getByRole("button", { name: "Add photo" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(count).toBe((before ?? 0) + 2);
});
