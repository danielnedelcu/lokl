import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { signIn } from "../support/auth";
import { ADMIN, ADMIN_COOKIE } from "../support/env";
import { signInEmail, typeCode } from "../support/mail";
import { expect, test } from "../support/fixtures";
import { freshTotp } from "../support/totp";

// Journey 30: a real admin signs in to the admin app, set up as the dev
// servers are: the website and the admin app on localhost (two ports), one
// Supabase project, the admin made by hand with CLAUDE.md's SQL after their
// login exists, signing in by emailed code and then setting up the
// authenticator a new team member needs (admin roles, 2026-10-18). Found 2026-10-17: with a
// provider signed in on the website in the same browser, the admin was sent
// to "That account doesn't have admin access": cookies ignore the port, so
// both apps shared one session cookie. Each app now has its own (the admin
// app's supabase.cookiePrefix).

/**
 * Adds a login to the team as CLAUDE.md says (the SQL Editor), on the local
 * database: its own block, read from CLAUDE.md, so the two can't drift.
 */
function grantAdmin(dbUrl: string, email: string) {
  const rules = readFileSync("CLAUDE.md", "utf8"); // run from the repo root (scripts/e2e.mjs)
  const block = rules.match(/```sql\n(\s*do \$\$[\s\S]*?admin_members[\s\S]*?\$\$;)\n\s*```/)?.[1];
  if (!block) throw new Error("CLAUDE.md has no block adding someone to admin_members.");
  execFileSync("psql", [dbUrl, "-q", "-v", "ON_ERROR_STOP=1"], { input: block.replace("<admin email>", email.replaceAll("'", "''")) });
}

/** Signs in by emailed code; a new team member then sets up an authenticator, and the admin opens. */
async function adminSignsInByCode(page: import("@playwright/test").Page, mailpitUrl: string, email: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  const mail = await signInEmail(mailpitUrl, email);
  await typeCode(page, page, mail.code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/security\?setup=1$/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Set up an authenticator" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.locator("#authenticator-key").innerText()).replace(/\s/g, "");
  await typeCode(page, page, await freshTotp(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Phone is set up.").first()).toBeVisible();
  await page.goto(`${ADMIN}/`);
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
