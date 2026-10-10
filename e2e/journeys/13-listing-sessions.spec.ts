import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 13: the sessions panel on an Experience's editor counts each
// session's bookings in the database (listing_sessions_page), so a listing
// with more than 1,000 booking rows still shows the right numbers. Recreates
// the cut-off found on 2026-10-10: the panel read every booking row on the
// listing and added them up in the browser, and the API returns at most
// 1,000 rows.

test("a session's bookings are counted however many rows the listing has", async ({ page, context, data }) => {
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const upcoming = await data.session(listing.id, daysFromNow(5), 20);

  // Test-only, local database, guards off: an old session with 1,050
  // abandoned checkouts, then two confirmed bookings on the upcoming one,
  // written last.
  const old = randomUUID();
  const row = (session: string, status: string, people: number, startsSql: string) =>
    `('experience', '${listing.id}', '${provider}', '${customer.id}', '${session}', 'Sam', 5000, ${people}, ${5000 * people}, '${status}', ${startsSql}, ${startsSql} + interval '1 hour')`;
  const abandoned = Array.from({ length: 1050 }, () => row(old, "expired", 1, "now() - interval '20 days'"));
  // On standard input: Linux caps one command-line argument at 128 KB.
  execFileSync("psql", [data.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: `
    set local session_replication_role = replica;
    insert into public.experience_sessions (id, listing_id, starts_at, capacity) values ('${old}', '${listing.id}', now() - interval '20 days', 500);
    insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, party_size, total_cents, status, starts_at, ends_at)
    values ${abandoned.join(",")};
    insert into public.bookings (kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, party_size, total_cents, status, starts_at, ends_at)
    values ${row(upcoming, "confirmed", 2, `(select starts_at from public.experience_sessions where id = '${upcoming}')`)},
           ${row(upcoming, "confirmed", 3, `(select starts_at from public.experience_sessions where id = '${upcoming}')`)};` });

  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/listings/${listing.id}`);
  await expect(page.getByText("20 spots · 5 booked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Past sessions (1)" })).toBeVisible();

  // Cancelling it goes to the refund dialog (it has bookings), naming the
  // people booked and the refund.
  await page.getByRole("button", { name: /^Cancel the session on / }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toContainText("5 people are booked");
  await expect(dialog).toContainText("($250.00 in total)");
});

test("upcoming sessions come 50 at a time, with Show more", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  // Test-only, local database: 55 upcoming sessions, a day apart.
  execFileSync("psql", [data.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "-c", `
    insert into public.experience_sessions (listing_id, starts_at, capacity)
    select '${listing.id}', date_trunc('hour', now()) + g * interval '1 day', 10 from generate_series(1, 55) g;`]);

  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/listings/${listing.id}`);
  const rows = page.locator('[data-session="upcoming"]');
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "Show more upcoming sessions (5 more)" }).click();
  await expect(rows).toHaveCount(55);
  await expect(rows.nth(50)).toBeFocused();
  await expect(page.getByRole("button", { name: /^Show more upcoming sessions/ })).toHaveCount(0);
});
