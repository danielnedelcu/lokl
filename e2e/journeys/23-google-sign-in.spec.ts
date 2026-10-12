import { createHash } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { TestData, TestUser } from "../support/data";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 23: "Continue with Google" (docs/design/sign-in-with-code.md,
// Google; 2026-10-11). Google can't be signed in to from a test, and Supabase
// checks every Google token with Google, so both are stood in for: Google's
// script by one that draws a plain "Continue with Google" button and hands
// back a made-up token, and Supabase's token endpoint by a real session for
// a local test user. Everything after that is the app's own: where the
// person goes, focus, a saved heart, /login's destination, the nonce, and a
// refusal. Linking a Google sign-in to an account made by code is checked
// on staging with a real Google account (docs/TODO.md).

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

/** Google's script, stood in for: records what it was given, and signs in when its button is pressed. */
const FAKE_GOOGLE = `
window.google = { accounts: { id: {
  initialize(config) { window.__google = config; },
  renderButton(parent, options) {
    window.__googleButton = options;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Continue with Google";
    b.onclick = () => window.__google.callback({ credential: "made-up.google.token", select_by: "btn" });
    parent.appendChild(b);
  },
} } };`;

interface GoogleStandIn {
  /** Every request to Google's servers (the script). */
  googleRequests: string[];
  /** What the app sent Supabase for the Google sign-in. */
  sent: () => { provider?: string; id_token?: string; nonce?: string } | null;
}

/** Stands in for Google and for Supabase's answer: signing in as `person`, or refused. */
async function standInForGoogle(page: Page, data: TestData, person: TestUser | "refused"): Promise<GoogleStandIn> {
  const googleRequests: string[] = [];
  page.on("request", (r: Request) => { if (new URL(r.url()).hostname.endsWith("google.com")) googleRequests.push(r.url()); });
  await page.route(GOOGLE_SCRIPT, (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_GOOGLE }));
  let sent: ReturnType<GoogleStandIn["sent"]> = null;
  await page.route((url) => url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "id_token", async (route) => {
    sent = route.request().postDataJSON();
    if (person === "refused") {
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "bad_jwt", msg: "Bad ID token" }) });
    }
    // A real session for the person, as Supabase would answer for their Google account.
    const anon = createClient(data.env.apiUrl, data.env.publishableKey, { auth: { persistSession: false } });
    const { data: signedIn, error } = await anon.auth.signInWithPassword({ email: person.email, password: person.password });
    if (error || !signedIn.session) throw new Error(`couldn't make a session: ${error?.message}`);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(signedIn.session) });
  });
  return { googleRequests, sent: () => sent };
}

test("from the header: Google's script loads only with sign-in, the person stays on the page, and the nonce matches", async ({ page, data }) => {
  const owner = await data.user("google-owner");
  await data.provider(owner);
  const google = await standInForGoogle(page, data, owner);

  await page.goto("/atlanta/experiences");
  // Once the page has come to life in the browser (the dialog's code mounts
  // after it loads) and gone quiet: nothing from Google.
  await page.waitForLoadState("networkidle");
  expect(google.googleRequests, "nothing from Google with the page").toEqual([]);

  // Email keeps first focus; Google's button is below the code form; Escape puts focus back.
  const opener = page.getByRole("button", { name: "Sign in", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
  const googleButton = dialog.getByRole("button", { name: "Continue with Google" });
  await expect(googleButton).toBeVisible();
  expect(google.googleRequests, "Google's script loads once sign-in is open").toEqual([GOOGLE_SCRIPT]);
  const below = await googleButton.boundingBox();
  const send = await dialog.getByRole("button", { name: "Send me a code" }).boundingBox();
  expect(below!.y, "below the code form").toBeGreaterThan(send!.y);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();

  await opener.click();
  await dialog.getByRole("button", { name: "Continue with Google" }).click();

  // Still on the page, focus on the Account button, the dashboard offered to a business.
  await expect(page).toHaveURL(/\/atlanta\/experiences$/);
  await expect(page.getByRole("button", { name: "Account" })).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: `Signed in as ${owner.email}.` }).getByRole("button", { name: "Go to your dashboard" })).toBeVisible();

  // The nonce: Supabase got the value whose SHA-256 fingerprint Google was given.
  const sent = google.sent()!;
  expect([sent.provider, sent.id_token]).toEqual(["google", "made-up.google.token"]);
  const givenToGoogle = await page.evaluate(() => (window as unknown as { __google: { nonce: string } }).__google.nonce);
  expect(createHash("sha256").update(sent.nonce!).digest("hex"), "the nonce matches").toBe(givenToGoogle);
});

test("Get started with Google goes on to the dashboard", async ({ page, data }) => {
  const person = await data.user("google-host");
  await standInForGoogle(page, data, person);
  await page.goto("/");
  await page.getByRole("region", { name: "On lokl now" }).getByRole("button", { name: "Get started" }).click();
  await page.getByRole("dialog", { name: "Sign in or sign up to start hosting" }).getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("#main")).toBeFocused();
});

test("a heart tapped while signed out is saved after signing in with Google", async ({ page, data }) => {
  const owner = await data.user("google-heart-owner");
  const providerId = await data.provider(owner, `E2E Google heart ${data.run}`);
  const listing = await data.listing(providerId, "experience", (await data.category("experience")).id, await data.area());
  const customer = await data.user("google-saver");
  await standInForGoogle(page, data, customer);

  await page.goto(`/experiences/${listing.slug}`);
  const heart = page.getByRole("button", { name: `Save ${listing.title}`, exact: true });
  await expect(heart).toBeVisible();
  await heart.click();
  await page.getByRole("dialog", { name: `Sign in to save ${listing.title}` }).getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText(`Saved ${listing.title}.`)).toBeVisible();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`/experiences/${listing.slug}$`));
});

test("on /login, Google goes where the person was headed", async ({ page, data }) => {
  const person = await data.user("google-login");
  await standInForGoogle(page, data, person);
  await page.goto("/account/bookings");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/account\/bookings$/);
});

test("a refused Google sign-in says so, and the dialog stays open", async ({ page, data }) => {
  await standInForGoogle(page, data, "refused");
  await page.goto("/atlanta/experiences");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in or sign up" });
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Google sign-in didn't work. Try again, or use a code.");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
});

test("the admin app's sign-in has no Google button", async ({ page, data }) => {
  const google = await standInForGoogle(page, data, "refused");
  await page.goto(`${ADMIN}/login`);
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  expect(google.googleRequests, "nothing from Google").toEqual([]);
});
