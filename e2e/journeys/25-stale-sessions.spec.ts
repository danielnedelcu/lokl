import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 25: the homepage with a session that's gone stale, or a signed-in
// provider whose own listings are in its carousels (2026-10-12: a browser
// still holding an old session showed "Something went wrong" on the dev
// server). Each loads the homepage, with no page errors, and a session
// whose user has been deleted is cleared and the page shown signed out
// (plugins/clear-stale-session.client.ts).

const authCookies = async (context: import("@playwright/test").BrowserContext) =>
  (await context.cookies()).filter((c) => c.name.includes("auth-token")).length;

test("a deleted user's session, its token still valid: cleared, and the page shown signed out", async ({ page, context, data }) => {
  const person = await data.user("ghost-fresh");
  await signIn(context, person.email, person.password);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await data.env.db.auth.admin.deleteUser(person.id);
  // The access token is still within its hour, so it checks out on its own;
  // only asking Supabase shows the user is gone.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" }), "shown signed out").toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
  await expect.poll(() => authCookies(context), { message: "the session's cookies are gone" }).toBe(0);
  // ...and it stays cleared on the next page.
  await page.goto("/services");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(errors, "no page errors").toEqual([]);
});

test("a deleted user's expired session: the homepage loads, signed out", async ({ page, context, data }) => {
  const person = await data.user("ghost");
  await signIn(context, person.email, person.password);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await data.env.db.auth.admin.deleteUser(person.id);
  // The session's access token has run out, so the next request tries to
  // refresh it, and the refresh is refused: the user is gone.
  for (const c of (await context.cookies()).filter((c) => c.name.includes("auth-token") && c.value.startsWith("base64-"))) {
    const s = JSON.parse(Buffer.from(c.value.slice(7), "base64").toString("utf8"));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    await context.addCookies([{ ...c, value: `base64-${Buffer.from(JSON.stringify(s)).toString("base64")}` }]);
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "On lokl now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
  expect(errors, "no page errors").toEqual([]);
});

test("a signed-in provider whose listings are in the carousels: the homepage loads", async ({ page, context, data }) => {
  const owner = await data.user("carousel-provider");
  const provider = await data.provider(owner, `E2E Own Listings ${data.run}`);
  const category = (await data.category("service")).id;
  const area = await data.area();
  for (let i = 1; i <= 3; i++) await data.listing(provider, "service", category, area, `Own cut ${i} ${data.run}`);
  await signIn(context, owner.email, owner.password);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The homepage's listings show a new listing within about a second (the
  // content versions are read once a second), so it's polled for briefly.
  await expect.poll(async () => {
    const res = await page.goto("/");
    if (res?.status() !== 200 || (await page.getByRole("heading", { name: "Something went wrong" }).count())) return "error page";
    return (await page.getByText(`Own cut 1 ${data.run}`).count()) ? "shown" : "not yet";
  }, { message: "the provider's own listing in the carousels", timeout: 5_000, intervals: [250, 500] }).toBe("shown");
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  // No heart on their own listing; it's still a link to it.
  const card = page.getByRole("listitem").filter({ hasText: `Own cut 1 ${data.run}` }).first();
  await expect(card.getByRole("link")).toBeVisible();
  await expect(card.getByRole("button", { name: /^Save / })).toHaveCount(0);
  expect(errors, "no page errors").toEqual([]);
});
