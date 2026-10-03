// Providers answering Service requests (docs/design/booking-and-checkout.md,
// step 4 part 4): accepting charges the held card once and shares the
// customer's details; declining releases the hold; late answers, times not
// offered and a card that can't be charged are handled. Runs the routes' own
// code (server/utils/bookingAnswers.ts) against the LOCAL stack and the LOKL
// SANDBOX (test mode only). Card holds are made with Stripe's test card
// token, so no browser payment is needed.
// Run: npx tsx supabase/tests/app/provider-bookings.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { stripeTestKey } from "./_stripeKey";
import {
  acceptRequest,
  ALREADY_ANSWERED,
  CARD_NOT_CHARGED,
  declineRequest,
  requestOverlaps,
} from "../../../apps/website/server/utils/bookingAnswers";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = stripeTestKey();
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
const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };
const statusOf = async (id: string) => (await must(db.schema("private").from("booking_records").select("status").eq("id", id).single())).status as string;
const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  // Test logins on the local stack only, with a throwaway password, so the
  // access checks read as each person.
  const password = randomBytes(18).toString("base64url");
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `answers-${label}-${run}@test.local`, password, email_confirm: true }));
    created.users.push(u.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: u.email!, password }));
    return { id: u.id, email: u.email!, client };
  };
  const owner = await user("provider");
  const other = await user("other-provider");
  const customer = await user("customer");
  const provider = async (ownerId: string, name: string) => {
    const id = (await must(db.from("providers").insert({ owner_id: ownerId, display_name: name, city_id: atl.id }).select("id").single())).id;
    created.providers.push(id);
    await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", id));
    return id as string;
  };
  const providerId = await provider(owner.id, "Answers Test");
  await provider(other.id, "Someone Else");
  const cat = (await must(db.from("categories").insert({ kind: "service", name: `Answers ${run}`, slug: `answers-${run}` }).select("id").single())).id;
  created.categories.push(cat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Answers ${run}` }).select("id").single())).id;
  const listingId = randomUUID();
  created.listings.push(listingId);
  await must(db.from("listings").insert({
    id: listingId, provider_id: providerId, city_id: atl.id, kind: "service", category_id: cat, title: `Answers cut ${run}`,
    description: "A Service made by the provider bookings test.", price_cents: 4500, duration_minutes: 60,
    location_mode: "customer_location", status: "submitted",
  }));
  await must(db.from("listing_service_areas").insert({ listing_id: listingId, service_area_id: created.area }));
  await must(db.from("listing_photos").insert({ listing_id: listingId, storage_path: `${providerId}/${listingId}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
  await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", listingId));

  // A paid request: the database makes the booking, Stripe holds the card
  // (manual capture, as Checkout does), and it becomes "requested".
  const day = 864e5;
  const t1 = new Date(Math.ceil((Date.now() + 3 * day) / 900_000) * 900_000).toISOString();
  const t2 = new Date(Date.parse(t1) + day).toISOString();
  const request = async () => {
    const b = await must(db.rpc("create_service_request", {
      p_listing_id: listingId, p_customer_id: customer.id, p_preferred_times: [t1, t2], p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: "404-555-0100", p_customer_notes: "Short on top",
      p_address: { line1: "12 Elm Street", city: "Atlanta", state: "GA", postal_code: "30312" },
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({
      amount: 4500, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true,
      payment_method_types: ["card"], metadata: { booking_id: b.id, test: "provider-bookings" },
    });
    await must(db.schema("private").from("booking_records").update({
      status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: pi.id,
      respond_by: new Date(Date.now() + 2 * day).toISOString(),
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };

  // 1. Before accepting: the area, not the street address or contact details.
  const a = await request();
  const seen = await must(owner.client.from("bookings").select("customer_city, customer_postal_code").eq("id", a.id).single());
  check(seen.customer_city === "Atlanta" && seen.customer_postal_code === "30312", "1a. the provider sees the customer's city and zip code on the request");
  check((await must(owner.client.from("booking_addresses").select("line1").eq("booking_id", a.id))).length === 0, "1b. ...but not the street address");
  check((await must(owner.client.from("booking_contacts").select("email").eq("booking_id", a.id))).length === 0, "1c. ...or the email and phone");
  check((await must(other.client.from("bookings").select("id").eq("id", a.id))).length === 0, "1d. another provider can't see the request at all");

  // 2. A time the customer didn't offer is refused; nothing is charged.
  const notOffered = new Date(Date.parse(t1) + 3600_000).toISOString();
  check((await refused(() => acceptRequest(db, stripe, a.id, notOffered))) === "Accept one of the times the customer offered.", "2a. a time the customer didn't offer is refused");
  check((await stripe.paymentIntents.retrieve(a.pi)).status === "requires_capture", "2b. ...and the card is still only on hold");

  // 3. Accepting charges the card once, and shares the customer's details.
  check((await acceptRequest(db, stripe, a.id, t2)) === "accepted", "3a. the provider accepts the second time offered");
  const pa = await stripe.paymentIntents.retrieve(a.pi);
  check(pa.status === "succeeded" && pa.amount_received === 4500, `3b. the card is charged $45.00 (${pa.status}, ${pa.amount_received})`);
  const ab = await must(db.schema("private").from("booking_records").select("status, starts_at, stripe_charge_id, payout_due_at").eq("id", a.id).single());
  check(ab.status === "confirmed" && Date.parse(ab.starts_at) === Date.parse(t2) && !!ab.stripe_charge_id, "3c. the booking is confirmed for that time, with its charge recorded");
  check((await acceptRequest(db, stripe, a.id, t2)) === "already accepted", "3d. accepting again (a double click) changes nothing");
  check((await stripe.charges.list({ payment_intent: a.pi })).data.length === 1, "3e. ...and there's still only one charge");
  const addr = await must(owner.client.from("booking_addresses").select("line1").eq("booking_id", a.id));
  const contact = await must(owner.client.from("booking_contacts").select("email, phone").eq("booking_id", a.id));
  check(addr[0]?.line1 === "12 Elm Street" && contact[0]?.email === customer.email && contact[0]?.phone === "404-555-0100",
    "3f. once accepted, the provider reads the street address, email and phone");
  check((await must(other.client.from("booking_contacts").select("email").eq("booking_id", a.id))).length === 0, "3g. another provider still can't");
  check((await refused(() => declineRequest(db, stripe, a.id))) === ALREADY_ANSWERED, "3h. an accepted booking can't then be declined");

  // 4. A late answer is refused; the hold isn't touched.
  const late = await request();
  await must(db.schema("private").from("booking_records").update({ respond_by: new Date(Date.now() - 60_000).toISOString() }).eq("id", late.id));
  check((await refused(() => acceptRequest(db, stripe, late.id, t1))) === "The time to answer this request has passed.", "4a. accepting after the answer-by time is refused");
  check((await stripe.paymentIntents.retrieve(late.pi)).status === "requires_capture", "4b. ...and nothing is charged");
  await stripe.paymentIntents.cancel(late.pi);

  // 5. Declining releases the hold.
  const d = await request();
  check((await declineRequest(db, stripe, d.id)) === "declined", "5a. the provider declines");
  check((await stripe.paymentIntents.retrieve(d.pi)).status === "canceled", "5b. the hold is released, so nothing is charged");
  check((await statusOf(d.id)) === "declined", "5c. the booking is declined");
  check((await declineRequest(db, stripe, d.id)) === "already declined", "5d. declining again changes nothing");
  check((await refused(() => acceptRequest(db, stripe, d.id, t1))) === ALREADY_ANSWERED, "5e. a declined request can't then be accepted");
  check((await must(owner.client.from("booking_contacts").select("email").eq("booking_id", d.id))).length === 0, "5f. the provider never sees a declined customer's details");

  // 6. A card that can't be charged any more ends the request.
  const gone = await request();
  await stripe.paymentIntents.cancel(gone.pi); // as if the hold lapsed
  check((await refused(() => acceptRequest(db, stripe, gone.id, t1))) === CARD_NOT_CHARGED, "6a. accepting when the card can't be charged says so");
  check((await statusOf(gone.id)) === "expired", "6b. ...and the request ends, with nothing charged");

  // 7. The provider can't change a booking with their own login; only the server can.
  const own = await request();
  await owner.client.from("bookings").update({ status: "declined", status_changed_by: "provider" }).eq("id", own.id);
  check((await statusOf(own.id)) === "requested", "7. a provider's own login can't change a booking's status");
  await declineRequest(db, stripe, own.id);

  // 8. Overlap warnings (a warning only).
  const confirmed = [{ id: "x", starts_at: t2, ends_at: new Date(Date.parse(t2) + 3600_000).toISOString(), title: "Another cut" }];
  const flags = requestOverlaps([t1, new Date(Date.parse(t2) + 30 * 60_000).toISOString(), new Date(Date.parse(t2) + 3600_000).toISOString()], 60, confirmed);
  check(flags[0]!.length === 0 && flags[1]!.length === 1 && flags[2]!.length === 0,
    "8. an offered time overlapping a confirmed booking is flagged; back-to-back isn't");
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
      delete from booking_addresses where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from listing_service_areas where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All provider booking checks passed.");
process.exit(failures ? 1 : 0);
