import { execFileSync } from "node:child_process";
import { signIn } from "../support/auth";
import { ADMIN, ADMIN_COOKIE } from "../support/env";
import { signInEmail, typeCode } from "../support/mail";
import { expect, test } from "../support/fixtures";

// Journey 30: a real admin signs in to the admin app, set up as the dev
// servers are: the website and the admin app on localhost (two ports), one
// Supabase project, the admin made by hand with CLAUDE.md's SQL after their
// login exists, signing in by emailed code. Found 2026-10-17: with a
// provider signed in on the website in the same browser, the admin was sent
// to "That account doesn't have admin access": cookies ignore the port, so
// both apps shared one session cookie. Each app now has its own (the admin
// app's supabase.cookiePrefix).

/** Makes a login an admin as CLAUDE.md says (the SQL Editor), on the local database. */
function grantAdmin(dbUrl: string, email: string) {
  execFileSync("psql", [dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "-c", `
    update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}'
     where email = '${email.replaceAll("'", "''")}';`]);
}

async function adminSignsInByCode(page: import("@playwright/test").Page, mailpitUrl: string, email: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  const mail = await signInEmail(mailpitUrl, email);
  await typeCode(page, page, mail.code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an admin made by hand signs in to the admin app by code", async ({ page, data }) => {
  const admin = await data.user("hand-admin");
  grantAdmin(data.env.dbUrl, admin.email);
  await adminSignsInByCode(page, data.env.mailpitUrl, admin.email);
  await expect(page).toHaveURL(new RegExp(`^${ADMIN}/?$`), { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.goto(`${ADMIN}/providers`);
  await expect(page).toHaveURL(`${ADMIN}/providers`);
  await expect(page.getByText("That account doesn't have admin access")).toHaveCount(0);
});

test("an admin signs in to the admin app while a provider is signed in on the website, in the same browser", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  await data.provider(owner);
  const admin = await data.user("hand-admin2");
  grantAdmin(data.env.dbUrl, admin.email);

  // The provider's website tab, signed in and left open.
  await signIn(context, owner.email, owner.password);
  const website = await context.newPage();
  await website.goto("/dashboard");
  await expect(website.getByRole("link", { name: "Bookings" }).first()).toBeVisible();

  // The admin app, in another tab of the same browser.
  await adminSignsInByCode(page, data.env.mailpitUrl, admin.email);
  await expect(page).toHaveURL(new RegExp(`^${ADMIN}/?$`), { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.goto(`${ADMIN}/providers`);
  await expect(page).toHaveURL(`${ADMIN}/providers`);

  // Two session cookies, one per app.
  const names = (await context.cookies()).map((c) => c.name.replace(/\.\d+$/, ""));
  expect(names).toContain(ADMIN_COOKIE);
  expect(names.filter((n) => /^sb-.+-auth-token$/.test(n) && n !== ADMIN_COOKIE).length).toBeGreaterThan(0);

  // Each app keeps its own login.
  await website.reload();
  await expect(website.getByText(owner.email)).toBeVisible();
  await page.reload();
  await expect(page.getByText(admin.email)).toBeVisible();
});
