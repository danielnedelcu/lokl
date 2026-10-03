// Booking routes without a payment (docs/design/booking-and-checkout.md):
// a provider whose Stripe account can't take charges or receive payouts can't
// be booked; abandoning an open checkout frees the booking at once; syncing a
// checkout that's still open changes nothing. Runs the routes' own code
// against the LOCAL stack and the LOKL SANDBOX (test mode only).
// Run: npx tsx supabase/tests/app/booking-routes.test.mts

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  abandonCheckout,
  NOT_TAKING_BOOKINGS,
  startExperienceCheckout,
  startServiceCheckout,
  syncCheckoutSession,
} from "../../../apps/website/server/utils/bookings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const webEnv = Object.fromEntries(fs.readFileSync(new URL("../../../apps/website/.env", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const key = webEnv.NUXT_STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
const stripe = new Stripe(key);
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const countBookings = async (listingId: string) => (await must(db.schema("private").from("booking_records").select("id").eq("listing_id", listingId))).length;
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `routes-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Routes Test", city_id: atl.id }).select("id").single())).id;
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Routes svc ${run}`, slug: `routes-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Routes exp ${run}`, slug: `routes-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Routes ${run}` }).select("id").single())).id;
  const listing = async (row: Record<string, unknown>) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({ id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", ...row }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const serviceId = await listing({ kind: "service", category_id: svcCat, title: `Routes cut ${run}`, description: "A Service made by the routes test.", price_cents: 3000, location_mode: "provider_location" });
  const experienceId = await listing({ kind: "experience", category_id: expCat, title: `Routes walk ${run}`, description: "An Experience made by the routes test.", price_cents: 2000, duration_minutes: 60 });
  const s1 = (await must(db.from("experience_sessions").insert({ listing_id: experienceId, starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), capacity: 2 }).select("id").single())).id;
  const ctx = { db, stripe, siteUrl: "http://localhost:3100", customer };
  const service = () => startServiceCheckout(ctx, { listingId: serviceId, name: "Sam", preferredTimes: [new Date(Date.now() + 3 * 864e5).toISOString()] });
  const experience = () => startExperienceCheckout(ctx, { sessionId: s1, partySize: 1, name: "Sam" });
  const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };

  // 1. Payouts not ready (a new provider): both kinds refused, nothing saved.
  check((await refused(service)) === NOT_TAKING_BOOKINGS, `1a. a Service is refused while payouts aren't ready ("${NOT_TAKING_BOOKINGS}")`);
  check((await refused(experience)) === NOT_TAKING_BOOKINGS, "1b. an Experience is refused while payouts aren't ready");
  check((await countBookings(serviceId)) + (await countBookings(experienceId)) === 0, "1c. no booking is saved, and no spot held");
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: false }).eq("id", created.provider));
  check((await refused(service)) === NOT_TAKING_BOOKINGS, "1d. still refused when charges work but payouts don't");
  await must(db.from("providers").update({ stripe_charges_enabled: false, stripe_payouts_enabled: true }).eq("id", created.provider));
  check((await refused(experience)) === NOT_TAKING_BOOKINGS, "1e. still refused when payouts work but charges don't");

  // 2. Payouts ready: booking works.
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const svc = await service();
  const exp = await experience();
  check(!!svc.url && !!exp.url, "2. with payouts ready, both kinds open a checkout");
  const svcSession = (await must(db.schema("private").from("booking_records").select("stripe_checkout_session_id").eq("id", svc.bookingId).single())).stripe_checkout_session_id as string;
  const expSession = (await must(db.schema("private").from("booking_records").select("stripe_checkout_session_id").eq("id", exp.bookingId).single())).stripe_checkout_session_id as string;

  // 3. Syncing a checkout that's still open changes nothing.
  check((await syncCheckoutSession(db, stripe, svcSession)) === "ignored: checkout not complete", "3a. syncing an open checkout changes nothing");
  check((await must(db.schema("private").from("booking_records").select("status").eq("id", svc.bookingId).single())).status === "pending_payment", "3b. ...the request is still pending payment");

  // 4. Abandoning an open checkout expires it in Stripe and frees the booking at once.
  check((await must(db.rpc("session_spots_left", { p_session_id: s1 }))) === 1, "4a. the open Experience checkout holds a spot");
  check((await abandonCheckout(db, stripe, expSession)) === "expired", "4b. abandoning it expires the booking");
  check((await stripe.checkout.sessions.retrieve(expSession)).status === "expired", "4c. ...and Stripe has the checkout as expired");
  check((await must(db.rpc("session_spots_left", { p_session_id: s1 }))) === 2, "4d. ...so the spot is free straight away");
  check((await abandonCheckout(db, stripe, svcSession)) === "expired", "4e. abandoning the Service checkout frees the request too");
  check((await abandonCheckout(db, stripe, svcSession)).startsWith("ignored"), "4f. abandoning it again changes nothing");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_finances where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_reports where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All booking route checks passed.");
process.exit(failures ? 1 : 0);
