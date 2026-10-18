import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { ADMIN, ANALYTICS, GOOGLE_ANALYTICS_HOSTS, testEnv, WEBSITE } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 33: pages load nothing from other sites the privacy policy doesn't
// name (decided 2026-10-17). Every request a page makes goes to the app
// itself or lokl's own Supabase project (data and photos). The exceptions:
// Google's sign-in script, only where a sign-in form is shown (and only when
// Google sign-in is turned on), and, where Google Analytics runs (here, the
// tests' analytics server, with every request to Google answered locally),
// exactly Google Analytics' hosts. Icons come from the bundle: with no
// fallback to Iconify's API, an icon missed by the bundle would draw blank,
// so every icon on these pages must have drawn.

const GOOGLE_SIGN_IN = "accounts.google.com";

/** Records (and stops) every request to a host that isn't allowed. */
async function watchHosts(context: BrowserContext, { googleSignIn = false, googleAnalytics = false } = {}) {
  const env = await testEnv();
  const allowed = new Set([new URL(WEBSITE).host, new URL(ADMIN).host, new URL(ANALYTICS).host, new URL(env.apiUrl).host]);
  const outside: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || allowed.has(url.host)) return route.continue();
    if (googleSignIn && url.host === GOOGLE_SIGN_IN) return route.fulfill({ contentType: "text/javascript", body: "" });
    // Answered here: nothing reaches Google.
    if (googleAnalytics && GOOGLE_ANALYTICS_HOSTS.includes(url.host)) return route.fulfill({ contentType: "text/javascript", body: "" });
    outside.push(`${url.host} (${url.pathname}) from ${route.request().frame().url()}`);
    return route.abort();
  });
  return outside;
}

/** Every icon on the page drew from the bundle: an svg with something in it. */
async function iconsDrew(page: Page) {
  const icons = await page.locator(".iconify").evaluateAll((els) =>
    els.map((el) => ({ tag: el.tagName.toLowerCase(), drawn: el.tagName.toLowerCase() === "svg" && el.childElementCount > 0, html: el.outerHTML.slice(0, 120) })));
  expect(icons.length, "the page has icons to check").toBeGreaterThan(0);
  expect(icons.filter((i) => !i.drawn), "every icon drew from the bundle").toEqual([]);
}

test("public pages, a listing, search and sign-in request nothing outside the app and lokl's Supabase", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const outside = await watchHosts(context, { googleSignIn: true });

  for (const path of ["/", "/atlanta", "/atlanta/experiences", `/experiences/${listing.slug}`, "/atlanta/search?kind=experience", "/review-rules"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await iconsDrew(page);
  }
  // A sign-in form: Google's script is the only outside request allowed, and only here.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  expect(outside, "no page requested an outside host").toEqual([]);
});

test("a signed-in customer's and provider's pages request nothing outside", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  await data.provider(owner);
  const outside = await watchHosts(context);
  await signIn(context, owner.email, owner.password);
  for (const path of ["/account/bookings", "/account/saved", "/dashboard", "/dashboard/bookings", "/dashboard/help"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await iconsDrew(page);
  }
  // The notification panel and its icons too.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.waitForLoadState("networkidle");
  expect(outside, "no page requested an outside host").toEqual([]);
});

test("the admin app requests nothing outside", async ({ context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const ctx = await context.browser()!.newContext();
  const outside = await watchHosts(ctx);
  await signIn(ctx, admin.email, admin.password, { app: "admin" });
  const page = await ctx.newPage();
  for (const path of ["/", "/reports", "/bookings", "/providers", "/security"]) {
    await page.goto(`${ADMIN}${path}`);
    await page.locator("main").waitFor();
    await page.waitForLoadState("networkidle");
    await iconsDrew(page);
  }
  // Setting up an authenticator: its QR code is drawn here from Supabase's
  // own response, never fetched from a QR service (2026-10-18).
  await page.getByRole("button", { name: "Add another authenticator" }).click();
  await page.getByLabel("Name it").fill("Tablet");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("img", { name: /QR code for your authenticator app/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(outside, "no page requested an outside host").toEqual([]);
  await ctx.close();
});

test("where Google Analytics runs, pages ask for exactly its hosts and nothing else", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const google: string[] = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (GOOGLE_ANALYTICS_HOSTS.includes(host)) google.push(host);
  });
  const outside = await watchHosts(context, { googleAnalytics: true });
  for (const path of ["/", "/atlanta/experiences", `/experiences/${listing.slug}`, "/atlanta/search?kind=experience"]) {
    await page.goto(`${ANALYTICS}${path}`);
    await page.waitForLoadState("networkidle");
    await iconsDrew(page);
  }
  expect(google.length, "Google Analytics was asked for (and answered here)").toBeGreaterThan(0);
  expect(outside, "nothing beyond the app, lokl's Supabase and Google Analytics' hosts").toEqual([]);
});
