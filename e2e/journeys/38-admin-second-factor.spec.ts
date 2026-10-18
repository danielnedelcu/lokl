import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";
import { typeCode } from "../support/mail";
import { authenticatorKeys, freshTotp } from "../support/totp";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Journey 38: an admin's second factor (docs/design/admin-roles.md, cutover
// steps 2 and 4), required for admin access. A team member without one is
// sent to set it up first: from a QR code drawn here or a key in groups of
// four, shown only while setting up; then a second one; signing in again
// asks for the second step; removing the last one is refused. (Journey 33
// checks these pages fetch nothing from other sites.)

/** Sets up an authenticator on /security with this name; returns its key. */
async function setUp(page: Page, name: string) {
  await page.getByRole("button", { name: /^(Set up an authenticator|Add another authenticator)$/ }).click();
  await page.getByLabel("Name it").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: `Add lokl to ${name}` })).toBeFocused();
  // Supabase's own QR code, drawn here, with its text alternative pointing to the key.
  const qr = page.getByRole("img", { name: /QR code for your authenticator app\. If you can't scan it, use the key below instead\./ });
  await expect(qr).toHaveAttribute("src", /^data:image\/svg/);
  const shown = (await page.locator("#authenticator-key").innerText()).trim();
  expect(shown, "the key in groups of four").toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/);
  await expect(page.getByRole("button", { name: "Copy the key" })).toBeVisible();
  const key = shown.replace(/\s/g, "");
  // The authenticator app lists it as "lokl admin", not the site's address.
  // (the link's address, shown only on phones but present on every screen)
  await expect(page.locator('a[href^="otpauth:"]')).toHaveAttribute("href", /^otpauth:\/\/totp\/lokl%20admin:[^?]+\?(.+&)?issuer=lokl(%20|\+)admin(&|$)/);
  await typeCode(page, page, await freshTotp(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(`${name} is set up.`).first()).toBeVisible();
  // Never shown again.
  await expect(page.locator("#authenticator-key")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  return key;
}

test("an admin sets up two authenticators; signing in again asks for the second step", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true, authenticator: false });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();

  // Without an authenticator, the team member is sent to set one up first.
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/security\?setup=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "Second factor" })).toBeVisible();
  await expect(page.getByText("None yet. Admin access needs one")).toBeVisible();

  const phone = await setUp(page, "Phone");
  // Setting it up passes the second step for this session: the admin app opens.
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(`${ADMIN}/bookings`);
  await page.goto(`${ADMIN}/security`);
  await expect(page.getByText("Add a second one, so losing this one doesn't lock you out.")).toBeVisible();
  // A name can't be used twice.
  await page.getByRole("button", { name: "Add another authenticator" }).click();
  await page.getByLabel("Name it").fill("phone");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("You already have an authenticator with that name.");
  await page.getByRole("button", { name: "Cancel" }).click();
  const backup = await setUp(page, "Password manager");
  await expect(page.getByRole("listitem").filter({ hasText: "Added" })).toHaveCount(2);
  expect(backup).not.toBe(phone);

  // Removing one of two: no warning.
  await page.getByRole("button", { name: "Remove Phone" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("You can still sign in with your other authenticator.");
  await page.getByRole("button", { name: "Keep it" }).click();

  // Signing in again: the emailed code (here, the test sign-in) is the first step only.
  await context.clearCookies();
  await signIn(context, admin.email, admin.password, { app: "admin" });
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/security\/verify\?to=(%2F|\/)bookings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Second step" })).toBeVisible();
  await page.getByRole("radio", { name: "Password manager" }).click();
  await typeCode(page, page, "000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work.");
  await typeCode(page, page, await freshTotp(backup));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${ADMIN}/bookings`);
});

test("removing your only authenticator is refused", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true, authenticator: false });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await setUp(page, "Phone");
  await page.getByRole("button", { name: "Remove Phone" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This is your only authenticator, and admin access needs one. Add another before removing this one.");
  await expect(dialog.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Phone" })).toBeVisible();
});

/** The admin's navigation and its bell: never shown to someone without a role. */
async function expectNoAdminFrame(page: Page) {
  await expect(page.getByRole("link", { name: "Bookings & payouts" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /notifications/i })).toHaveCount(0);
}

test("an invited member sets up two authenticators before joining; the rest stays closed", async ({ context, data }) => {
  const invited = await data.user("invited", { admin: "support", invited: true, authenticator: false });
  await signIn(context, invited.email, invited.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/`);
  await expect(page).toHaveURL(/\/security\?setup=1$/);
  await expectNoAdminFrame(page);
  await setUp(page, "Phone");
  // Adding a backup, after a reload, at aal2 but not yet on the team.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Second factor" })).toBeVisible();
  await expectNoAdminFrame(page);
  await setUp(page, "Password manager");
  await expect(page.getByRole("listitem").filter({ hasText: "Added" })).toHaveCount(2);
  // Joining happens on the owner's Team page; until then, nothing admin opens.
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/login\?denied=1$/);
});

test("someone not on the team, or removed from it, is turned away, /security included", async ({ context, data }) => {
  const outsider = await data.user("outsider");
  await signIn(context, outsider.email, outsider.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await expect(page).toHaveURL(/\/login\?denied=1$/);
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/login\?denied=1$/);

  // A removed member who still has an authenticator: the second step passes, the door stays shut.
  const removed = await data.user("removed", { admin: true });
  const owner = await data.user("owner", { admin: true });
  const { error } = await data.env.db.from("admin_members").update({ status: "removed", removed_by: owner.id, removed_at: new Date().toISOString() }).eq("user_id", removed.id);
  expect(error).toBeNull();
  await context.clearCookies();
  await signIn(context, removed.email, removed.password, { app: "admin" });
  await page.goto(`${ADMIN}/bookings`);
  await expect(page).toHaveURL(/\/login\?denied=1$/);
  await page.goto(`${ADMIN}/security`);
  await expect(page).toHaveURL(/\/login\?denied=1$/);
});

test("an active owner past the second step adds a backup, with an unfinished one left over", async ({ context, data }) => {
  // The owner's state at the push: "Phone" set up, an unfinished
  // "Password manager" from an earlier attempt, a session past the second step.
  const owner = await data.user("owner", { admin: true });
  const client = createClient(data.env.apiUrl, data.env.publishableKey, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
  const phoneId = (await client.auth.mfa.listFactors()).data!.totp[0]!.id;
  expect((await client.auth.mfa.challengeAndVerify({ factorId: phoneId, code: await freshTotp(authenticatorKeys.get(owner.email)!) })).error).toBeNull();
  expect((await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Password manager" })).error).toBeNull();
  await signIn(context, owner.email, owner.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await expect(page).toHaveURL(`${ADMIN}/security`);
  // The admin frame, as for any admin page.
  await expect(page.getByRole("link", { name: "Bookings & payouts" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Added" })).toHaveCount(1);
  await setUp(page, "Password manager");
  await expect(page.getByRole("listitem").filter({ hasText: "Added" })).toHaveCount(2);
  // Both confirmed in the database, and the unfinished one gone.
  const factors = execFileSync("psql", [data.env.dbUrl, "-X", "-At", "-c",
    `select status || ':' || count(*) from auth.mfa_factors where user_id = '${owner.id}' group by status`], { encoding: "utf8" }).trim();
  expect(factors).toBe("verified:2");
});

test("on a phone, setting up offers to open the authenticator app directly @phone", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true, authenticator: false });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/security`);
  await page.getByRole("button", { name: "Set up an authenticator" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const open = page.getByRole("link", { name: "Open in authenticator app" });
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /^otpauth:\/\/totp\//);
  } else {
    // On a computer the authenticator is on another device: scan or type the key.
    await expect(open).toBeHidden();
  }
  // Nothing scrolls sideways at this width, QR code and key included.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("when the access check itself fails, it says so and offers to try again", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  await signIn(context, admin.email, admin.password, { app: "admin" });
  const page = await context.newPage();
  // The database answers the access check with an error (not "no role").
  await page.route("**/rest/v1/rpc/admin_role", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' }));
  await page.goto(`${ADMIN}/bookings`);
  await expect(page.getByRole("heading", { level: 1, name: "We couldn't check your access" })).toBeVisible();
  await expect(page.getByText("That account doesn't have admin access")).toHaveCount(0);
  await expectNoAdminFrame(page);
  // Once it answers again, "Try again" goes back to where they were going.
  await page.unroute("**/rest/v1/rpc/admin_role");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(`${ADMIN}/bookings`);
});
