import { execFileSync } from "node:child_process";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 16: a timed job takes a batch of 200, most overdue first; a full
// batch is logged as "more waiting" in job_runs and shown to the admin, and
// the next run takes the rest (server/utils/bookingJobs.ts).

test("a full batch is logged as more waiting, and the next run clears it", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "service", (await data.category("service")).id, await data.area());

  // Test-only, local database, guards off: 201 requests past their answer-by
  // time, with their finances rows.
  const psql = (sql: string) => execFileSync("psql", [data.env.dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" }).trim();
  psql(`begin; set local session_replication_role = replica;
    insert into public.bookings (kind, listing_id, provider_id, customer_id, customer_name, unit_price_cents, total_cents, service_mode, starts_at, ends_at, status, respond_by)
    select 'service', '${listing.id}', '${provider}', '${customer.id}', 'Sam', 5000, 5000, 'approve', now() + interval '20 days', now() + interval '20 days 1 hour', 'requested', now() - g * interval '1 minute'
    from generate_series(1, 201) g;
    insert into public.booking_finances (booking_id, commission_rate_bps, commission_cents, provider_amount_cents)
    select id, 1200, 600, 4400 from public.bookings where listing_id = '${listing.id}';
    commit;`);
  const left = () => Number(psql(`select count(*) from public.bookings where listing_id = '${listing.id}' and status = 'requested'`));
  const lastRun = () => psql("select more_waiting from public.job_runs where job = 'expire-requests' order by finished_at desc limit 1");

  await data.job("expire-requests");
  expect(left(), "the first run expires a batch of 200, oldest first").toBeLessThanOrEqual(1);
  expect(lastRun(), "...and logs that more were waiting").toBe("t");

  await signIn(context, admin.email, admin.password, { app: "admin" });
  await page.goto(`${ADMIN}/bookings`);
  await expect(page.getByText("expire-requests").first()).toBeVisible();
  await expect(page.getByText("a full batch: more were waiting for the next run").first()).toBeVisible();

  await data.job("expire-requests");
  expect(left(), "the next run takes the rest").toBe(0);
  expect(lastRun(), "...and logs none waiting").toBe("f");
});
