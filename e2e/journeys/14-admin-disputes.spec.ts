import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { daysFromNow } from "../support/data";
import { expect, test } from "../support/fixtures";

// Journey 14: the admin's Disputes & refunds page lists every open dispute,
// counts closed disputes and refunds in full, and pages them 25 at a time
// (apps/admin/app/utils/disputes.ts).

test("open disputes are all listed; refunds are counted and paged", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());
  const session = await data.session(listing.id, daysFromNow(3), 100);

  // Test-only, local database, guards off: an open dispute and 30 refunds.
  const disputed = randomUUID();
  const row = (id: string, refunded: number) =>
    `('${id}', 'experience', '${listing.id}', '${provider}', '${customer.id}', '${session}', 'Sam', 5000, 5000, now() - interval '9 days', now() - interval '9 days' + interval '1 hour', ` +
    `'${refunded ? "cancelled" : "completed"}', ${refunded}, ${refunded ? "now() - interval '1 day'" : "null"}, ${refunded ? "'provider'" : "null"})`;
  const refunds = Array.from({ length: 30 }, () => randomUUID());
  execFileSync("psql", [data.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: `
    set local session_replication_role = replica;
    insert into public.bookings (id, kind, listing_id, provider_id, customer_id, session_id, customer_name, unit_price_cents, total_cents, starts_at, ends_at, status, refunded_cents, refunded_at, cancelled_by)
    values ${[row(disputed, 0), ...refunds.map((id) => row(id, 5000))].join(",")};
    insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents, stripe_dispute_id, disputed_at, dispute_reason, dispute_evidence_due_by)
    values ('${disputed}', 2000, 1000, 4000, 'dp_e2e_${data.run}', now() - interval '2 days', 'fraudulent', now() + interval '5 days');` });
  const totalRefunds = Number(execFileSync("psql", [data.env.dbUrl, "-X", "-At", "-c", "select count(*) from public.bookings where refunded_cents > 0"], { encoding: "utf8" }).trim());

  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/disputes`);
  const open = page.getByRole("region", { name: /^Open disputes/ }).or(page.locator("section[aria-labelledby='open-heading']"));
  await expect(open.getByRole("link", { name: listing.title })).toBeVisible();
  await expect(open).toContainText("reason: fraudulent");

  const refundList = page.locator("section[aria-labelledby='refunds-heading']");
  await expect(page.getByRole("heading", { name: `Refunds (${totalRefunds})` })).toBeVisible();
  await expect(refundList.getByRole("listitem")).toHaveCount(25);
  await refundList.getByRole("button", { name: `Show more refunds (${totalRefunds - 25} more)` }).click();
  await expect(refundList.getByRole("listitem")).toHaveCount(Math.min(totalRefunds, 50));
});
