// A checkout attempt retried after its response was lost
// (apps/website/server/utils/bookings.ts; docs/architecture/booking-and-payments.md).
// The page sends one key per attempt (checkoutKey); a retry with the same
// key and details returns the same booking and Checkout, never a second; the
// same key with other details is refused; a new attempt for the same
// Experience session ends the customer's earlier unpaid one, so it can't
// block them; a retry after the checkout ended says so.
//
// Runs the routes' own code against the LOCAL stack and the LOKL SANDBOX
// (test mode only). No payment is made.
// Run: npx tsx supabase/tests/app/booking-checkout-retry.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { safeStripe, STRIPE_CLIENT_OPTIONS } from "@repo/types";
import { stripeTestKey } from "./_stripeKey";
import { slotAfter } from "./_slots";
import { abandonCheckout, startExperienceCheckout, startServiceCheckout } from "../../../apps/website/server/utils/bookings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = stripeTestKey();
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
// Errors redacted where they happen (no key fragments in test output).
const stripe = safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS));
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });
const value = (sql: string) => execFileSync("psql", [local.DB_URL!, "-X", "-At", "-f", "-"], { input: sql, encoding: "utf8" }).trim();

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };
const bookingsOn = (sessionId: string, customerId: string) =>
  value(`select count(*) from public.bookings where session_id = '${sessionId}' and customer_id = '${customerId}' and status = 'pending_payment'`);
const statusOf = (id: string) => value(`select status from public.bookings where id = '${id}'`);
const spotsTaken = (sessionId: string) => value(`select public.session_spots_taken('${sessionId}')`);
const sessionOf = (bookingId: string) => value(`select stripe_checkout_session_id from public.booking_finances where booking_id = '${bookingId}'`);
// Each numbered part runs on its own, so one that fails doesn't hide the rest.
async function part(name: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (e) {
    failures++;
    console.error(`FAIL ${name} stopped: ${(e as Error).message}`);
  }
}

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `retry-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  const customer2 = await user("customer2");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Retry Test", city_id: atl.id }).select("id").single())).id;
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Retry svc ${run}`, slug: `retry-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Retry exp ${run}`, slug: `retry-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Retry ${run}` }).select("id").single())).id;
  const listing = async (row: Record<string, unknown>) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({ id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", ...row }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const serviceId = await listing({ kind: "service", booking_mode: "approve", category_id: svcCat, title: `Retry cut ${run}`, description: "A Service made by the retry test.", price_cents: 4500, location_mode: "provider_location", duration_minutes: 60 });
  const experienceId = await listing({ kind: "experience", category_id: expCat, title: `Retry walk ${run}`, description: "An Experience made by the retry test.", price_cents: 2500, duration_minutes: 90 });
  const session = async (days: number) => (await must(db.from("experience_sessions").insert({ listing_id: experienceId, starts_at: new Date(Date.now() + days * 864e5).toISOString(), capacity: 2 }).select("id").single())).id as string;
  const ctx = (c: { id: string; email: string }) => ({ db, stripe, siteUrl: "http://localhost:3100", customer: c });
  const exp = (sessionId: string, partySize: number, checkoutKey: string) => ({ sessionId, partySize, name: "Sam Customer", checkoutKey });

  // Shared by parts 1, 3 and 5.
  let s1 = "";
  const k1 = randomUUID();
  let first = { bookingId: "", url: "" };

  // 1. The same key twice: one booking, one Checkout, spots held once.
  await part("part 1", async () => {
    s1 = await session(5);
    first = await startExperienceCheckout(ctx(customer), exp(s1, 2, k1));
    const again = await startExperienceCheckout(ctx(customer), exp(s1, 2, k1));
    check(again.bookingId === first.bookingId, "1a. a retry with the same key returns the same booking");
    check(again.url === first.url, "1b. ...and the same Checkout link");
    check(bookingsOn(s1, customer.id) === "1", "1c. one booking exists, not two");
    check(spotsTaken(s1) === "2", `1d. the 2 spots are held once (taken: ${spotsTaken(s1)})`);
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionOf(first.bookingId));
    const reservedUntil = Date.parse(value(`select reserved_until from public.bookings where id = '${first.bookingId}'`));
    check(stripeSession.expires_at === Math.floor(reservedUntil / 1000), "1e. Checkout expires with the reservation (expires_at from reserved_until)");
  });

  // 2. The same key, at the same moment: still one booking and one Checkout.
  await part("part 2", async () => {
    const s2 = await session(6);
    const k2 = randomUUID();
    const [a, b] = await Promise.all([
      startExperienceCheckout(ctx(customer2), exp(s2, 1, k2)),
      startExperienceCheckout(ctx(customer2), exp(s2, 1, k2)),
    ]);
    check(a.bookingId === b.bookingId && a.url === b.url, "2a. two simultaneous requests with one key share one booking and Checkout");
    check(bookingsOn(s2, customer2.id) === "1" && spotsTaken(s2) === "1", "2b. ...one booking, spots held once");
  });

  // 3. The same key with other details is refused, plainly.
  await part("part 3", async () => {
    check((await refused(() => startExperienceCheckout(ctx(customer), exp(s1, 1, k1)))) ===
      "This checkout was started with different details. Check your details and try again.", "3. the same key with a different party size is refused");
  });

  // 4. A new attempt for the same session ends the earlier unpaid one: its
  await part("part 4", async () => {
    //    spots go back and its Stripe Checkout is expired, so it can't block.
    const s3 = await session(7);
    const lost = await startExperienceCheckout(ctx(customer), exp(s3, 2, randomUUID()));
    const fresh = await startExperienceCheckout(ctx(customer), exp(s3, 1, randomUUID())).catch((e) => ({ error: (e as Error).message }));
    check(!("error" in fresh), `4a. a new attempt with other details goes through (${"error" in fresh ? fresh.error : "ok"})`);
    check(statusOf(lost.bookingId) === "expired", "4b. the earlier unpaid attempt is expired");
    check((await stripe.checkout.sessions.retrieve(sessionOf(lost.bookingId))).status === "expired", "4c. ...and so is its Stripe Checkout");
    check(spotsTaken(s3) === "1", `4d. only the new attempt holds spots (taken: ${spotsTaken(s3)})`);
    // Another customer's attempt on the same session is never touched.
    const theirs = await startExperienceCheckout(ctx(customer2), exp(s3, 1, randomUUID()));
    check(statusOf(theirs.bookingId) === "pending_payment" && !("error" in fresh) && statusOf(fresh.bookingId) === "pending_payment",
      "4e. another customer's attempt on the same session is left alone");
  });

  // 5. After the checkout has ended, the same key says so.
  await part("part 5", async () => {
    await abandonCheckout(db, stripe, sessionOf(first.bookingId));
    check((await refused(() => startExperienceCheckout(ctx(customer), exp(s1, 2, k1)))) === "This checkout has ended. Please start again.",
      "5. a retry after the checkout ended gets the plain message");
  });

  // 6. After payment, the same key returns the booking's confirmation page.
  await part("part 6", async () => {
    const s4 = await session(8);
    const k4 = randomUUID();
    const paid = await startExperienceCheckout(ctx(customer2), exp(s4, 1, k4));
    psql(`set local session_replication_role = replica;
      update public.bookings set status = 'confirmed', confirmed_at = now(), payout_due_at = now() + interval '9 days' where id = '${paid.bookingId}';`);
    const afterPaid = await startExperienceCheckout(ctx(customer2), exp(s4, 1, k4));
    check(afterPaid.bookingId === paid.bookingId && afterPaid.url === `http://localhost:3100/account/bookings/${paid.bookingId}?checkout=done`,
      "6. a retry after payment returns the booking's confirmation page");
  });

  // 7. Services: the same key returns the same request; another time is refused.
  await part("part 7", async () => {
    const time = await slotAfter(db, serviceId, 3 * 864e5);
    const k7 = randomUUID();
    const svc = (startsAt: string, checkoutKey: string) => ({ listingId: serviceId, name: "Sam Customer", startsAt, checkoutKey });
    const req1 = await startServiceCheckout(ctx(customer), svc(time, k7));
    const req2 = await startServiceCheckout(ctx(customer), svc(time, k7));
    check(req1.bookingId === req2.bookingId && req1.url === req2.url, "7a. a Service retry with the same key returns the same request and Checkout");
    check(value(`select count(*) from public.bookings where listing_id = '${serviceId}' and customer_id = '${customer.id}'`) === "1", "7b. ...one request exists");
    const other = await slotAfter(db, serviceId, 4 * 864e5);
    check((await refused(() => startServiceCheckout(ctx(customer), svc(other, k7)))) ===
      "This checkout was started with different details. Check your details and try again.", "7c. the same key with another time is refused");
  });
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  // Expire every Checkout this run opened, then remove its data (local only).
  if (created.listings.length) {
    const ids = created.listings.map((id) => `'${id}'`).join(",");
    const open = value(`select coalesce(string_agg(f.stripe_checkout_session_id, ' '), '') from public.booking_finances f join public.bookings b on b.id = f.booking_id where b.listing_id in (${ids}) and f.stripe_checkout_session_id is not null`);
    for (const id of open.split(" ").filter(Boolean)) {
      const s = await stripe.checkout.sessions.retrieve(id).catch(() => null);
      if (s?.status === "open") await stripe.checkout.sessions.expire(id).catch(() => null);
    }
    psql(`set local session_replication_role = replica;
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_contacts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.bookings where listing_id in (${ids});`);
  }
  for (const id of created.listings) await db.from("listings").delete().eq("id", id);
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All checkout retry checks passed.");
process.exit(failures ? 1 : 0);
