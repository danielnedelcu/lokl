// Support's requests and the owner's approvals, the money side (admin roles,
// step 5b): the website's own code (adminBookings.ts, adminRequests.ts)
// against the LOCAL stack and the LOKL SANDBOX. Support refunds directly up
// to the limit, on what's left of the charge, and is refused above it
// before Stripe is asked; asks instead; the owner approves, and Stripe
// refunds once, with the history naming both. An approval shown an amount
// that has since changed does nothing. An approved refund whose reply is
// lost is finished by Stripe's webhook, which closes the request too.
// Run: npx tsx supabase/tests/app/admin-requests.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { DEFAULT_REFUND_LIMIT_CENTS, safeStripe, STRIPE_CLIENT_OPTIONS } from "@repo/types";
import { stripeTestKey } from "./_stripeKey";
import { adminCancelBooking } from "../../../apps/website/server/utils/adminBookings";
import { sendAdminEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { approveRequest } from "../../../apps/website/server/utils/adminRequests";
import { BookingError, handlePaymentsEvent } from "../../../apps/website/server/utils/bookings";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const key = stripeTestKey();
if (!/^(sk|rk)_test_/.test(key)) { console.error("Refusing to run: not a test-mode key."); process.exit(1); }
const stripe = safeStripe(new Stripe(key, STRIPE_CLIENT_OPTIONS));
if ((await stripe.accounts.retrieve()).id !== "acct_1UKIdIEfG7OyQ6pv") { console.error("Refusing to run: not the Lokl sandbox."); process.exit(1); }
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });
const psqlValue = (sql: string) => execFileSync("psql", [local.DB_URL!, "-X", "-At", "-c", sql], { encoding: "utf8" }).trim();

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
async function refusal(p: Promise<unknown>): Promise<BookingError | null> {
  try { await p; return null; } catch (e) { if (e instanceof BookingError) return e; throw e; }
}
const row = async (id: string) => must(db.schema("private").from("booking_records").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const refunds = async (pi: string) => (await stripe.refunds.list({ payment_intent: pi })).data;
const event = (type: string, object: { id: string }) => ({ id: `evt_test_${randomUUID()}`, type, data: { object } }) as unknown as Stripe.Event;
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const owner = await makeAdmin(local, `requests-owner-${run}@test.local`);
  const support = await makeAdmin(local, `requests-support-${run}@test.local`, { role: "support" });
  created.users.push(owner.id, support.id);
  const person = async (label: string) => {
    const { user } = await must(db.auth.admin.createUser({ email: `requests-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(user.id);
    return { id: user.id, email: user.email! };
  };
  const providerOwner = await person("provider");
  const customer = await person("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: providerOwner.id, display_name: `Requests ${run}`, city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Requests ${run}`, slug: `requests-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Requests ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, area_id: created.area, kind: "experience",
    category_id: created.category, title: `Requests crawl ${run}`, description: "A listing made by the requests test.", price_cents: 6500, duration_minutes: 60,
  }));
  // What going live needs (listing_readiness): a photo, the meeting address
  // and payouts. This provider has no payouts, as before: ready only while
  // the listing is approved, then set back.
  await must(db.from("listing_photos").insert({ listing_id: created.listing, storage_path: `${created.provider}/${created.listing}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
  await must(db.from("listing_addresses").insert({ listing_id: created.listing, line1: "1 Test Street", city: "Atlanta", state: "GA", postal_code: "30312" }));
  await must(db.from("listings").update({ status: "submitted" }).eq("id", created.listing));
  await must(db.from("providers").update({ stripe_account_id: `acct_test_requests${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", created.listing));
  await must(db.from("providers").update({ stripe_account_id: null, stripe_charges_enabled: false, stripe_payouts_enabled: false }).eq("id", created.provider));
  let sessions = 0;
  // A paid booking for `people` at $65 each, as checkout leaves it (a real sandbox payment).
  const paid = async (people: number) => {
    const s = (await must(db.from("experience_sessions").insert({
      listing_id: created.listing, starts_at: new Date(Date.now() + (144 + 2 * sessions++) * 3600_000).toISOString(), capacity: 6,
    }).select("id").single())).id as string;
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: s, p_customer_id: customer.id, p_party_size: people, p_customer_name: "Sam",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({ amount: 6500 * people, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"], metadata: { booking_id: b.id } });
    await must(db.schema("private").from("booking_records").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };
  const ask = async (bookingId: string, reason: string) =>
    (await must(support.client.rpc("admin_request_create", { p_kind: "refund", p_booking_id: bookingId, p_provider_id: null, p_reason: reason }))) as string;
  const request = async (id: string) => (await must(db.from("admin_requests").select("*").eq("id", id).single())) as Record<string, any>;

  // 0. The pages' fallback limit is the database's own default.
  const dbDefault = psqlValue(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'admin_settings' and column_name = 'refund_limit_cents'`);
  check(dbDefault === String(DEFAULT_REFUND_LIMIT_CENTS), `0a. DEFAULT_REFUND_LIMIT_CENTS matches admin_settings' default (${dbDefault})`);

  // 1. Support's direct refunds: up to the limit, refused above it before Stripe.
  const small = await paid(2);
  const big = await paid(3);
  const tooMuch = await refusal(adminCancelBooking(support.server, stripe, big.id, support.id, "The customer was ill."));
  check(tooMuch?.status === 403 && tooMuch.message.startsWith("This refund is $195.00, over the $150.00 support can refund."), `1a. support refunding $195 is refused (${tooMuch?.message})`);
  check((await refunds(big.pi)).length === 0, "1b. ...before Stripe is asked: nothing refunded");
  check(await adminCancelBooking(support.server, stripe, small.id, support.id, "The customer was ill.") === "cancelled and refunded", "1c. support refunds $130 directly");
  check((await refunds(small.pi)).length === 1, "1d. ...once");
  // Each refund by support goes to every owner (admin roles, step 5c), and its reservation is gone.
  check(psqlValue(`select count(*) from public.admin_refund_holds where booking_id = '${small.id}'`) === "0", "1e. the refund's reservation is replaced by its record");
  const sent: OutgoingEmail[] = [];
  const mailer: Mailer = { async send(e) { sent.push(e); return { id: `re_test_${sent.length}` }; } };
  const settings: EmailSettings = { mode: "send", allowlist: [], from: "lokl <test@test.local>", replyTo: "help@test.local", siteUrl: "http://localhost:3100" };
  await sendAdminEmails(db, mailer, settings, { adminUrl: "http://localhost:3101" });
  const told = sent.find((e) => e.to === owner.email && e.subject === "Support refunded or cancelled a booking");
  check(!!told && told.text.includes(`${support.email} refunded $130.00 and cancelled “Requests crawl ${run}” (Requests ${run}).`) && told.text.includes(`/bookings/${small.id}`)
    && !told.text.includes("The customer was ill."), "1f. the owner is emailed the refund, with the booking, never the reason");

  // 1g. A refund Stripe refuses: its reservation goes at once. One whose
  // outcome is unknown (no answer): it stays, as the money may have moved.
  const failing = (error: Error) => new Proxy(stripe, {
    get(target, prop, receiver) {
      if (prop === "refunds") return { ...target.refunds, create: async () => { throw error; }, list: target.refunds.list.bind(target.refunds) };
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof stripe;
  const refused = await paid(1);
  const lostOne1 = await paid(1);
  const holdsFor = (bookingId: string) => psqlValue(`select count(*) from public.admin_refund_holds where booking_id = '${bookingId}'`);
  await adminCancelBooking(support.server, failing(new Stripe.errors.StripeCardError({ message: "Your card was declined.", type: "card_error" } as never)), refused.id, support.id, "Customer was ill.")
    .catch(() => undefined);
  check(holdsFor(refused.id) === "0" && (await refunds(refused.pi)).length === 0, "1g. Stripe refuses the refund: nothing refunded, its reservation released at once");
  await adminCancelBooking(support.server, failing(new Stripe.errors.StripeConnectionError({ message: "socket hang up" } as never)), lostOne1.id, support.id, "Customer was ill.")
    .catch(() => undefined);
  check(holdsFor(lostOne1.id) === "1", "1h. no answer from Stripe: the reservation stands (the refund may have happened)");

  // 2. Asking, and the owner approving.
  const r1 = await ask(big.id, "The venue flooded; the customer can't attend.");
  check((await request(r1)).amount_cents === 19500, "2a. support asks the owner for the $195 refund");
  const changed = await refusal(approveRequest(owner.server, stripe, owner.id, r1, 10000));
  check(changed?.status === 409 && changed.message === "The refund is now $195.00, not the $100.00 you were shown. Check it and approve again.",
    `2b. an approval shown a different amount does nothing, and says the amount now (${changed?.message})`);
  check((await refunds(big.pi)).length === 0, "2c. ...nothing refunded");
  const blind = await refusal(approveRequest(owner.server, stripe, owner.id, r1, null));
  check(blind?.status === 400 && blind.message === "Approve a refund from the Requests page, which shows the amount it will refund.",
    `2b2. a refund's approval without the amount the owner was shown is refused (${blind?.message})`);
  check((await refunds(big.pi)).length === 0, "2b3. ...nothing refunded");
  const bySupport = await refusal(approveRequest(support.server, stripe, support.id, r1, 19500));
  check(bySupport?.status === 403, "2d. support can't approve, even their own request");
  check(await approveRequest(owner.server, stripe, owner.id, r1, 19500) === "cancelled and refunded", "2e. the owner approves: cancelled and refunded");
  check((await refunds(big.pi)).length === 1 && (await row(big.id)).refunded_cents === 19500, "2f. ...Stripe refunded $195 once");
  const r1Row = await request(r1);
  check(r1Row.status === "approved" && r1Row.decided_by === owner.id && r1Row.result === "Cancelled and refunded $195.00.", `2g. the request is approved by the owner (${r1Row.status}, ${r1Row.result})`);
  const history = psqlValue(`select a.admin_id || '/' || r.requested_by || '/' || a.reason from public.admin_actions a join public.admin_requests r on r.id = a.request_id
    where a.target = 'booking' and a.target_id = '${big.id}' and a.action = 'cancel_booking'`);
  check(history === `${owner.id}/${support.id}/The venue flooded; the customer can't attend.`, "2h. the booking's history: done by the owner, asked by support, with support's reason");
  check((await approveRequest(owner.server, stripe, owner.id, r1, 19500)).startsWith("already approved"), "2i. approving again says it's done");
  check((await refunds(big.pi)).length === 1, "2j. ...and refunds nothing more");

  // 3. An approved refund whose reply is lost: Stripe's webhook finishes it and closes the request.
  const lostOne = await paid(3);
  const r2 = await ask(lostOne.id, "Double charged by mistake, per the customer.");
  // The owner's server, "crashing" on lokl's cancel function, after Stripe refunded.
  const crashing = new Proxy(owner.server, {
    get(target, prop, receiver) {
      if (prop === "rpc") return (fn: string, args: unknown) => {
        if (fn === "admin_cancel_booking") throw new Error("the server stopped before the database write");
        return target.rpc(fn as never, args as never);
      };
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof owner.server;
  await approveRequest(crashing, stripe, owner.id, r2, 19500).catch(() => undefined);
  const [lostRefund] = await refunds(lostOne.pi);
  check(!!lostRefund && lostRefund.metadata?.admin_request_id === r2 && lostRefund.metadata?.admin_id === owner.id,
    "3a. the refund's Stripe metadata names the request beside the admin");
  check((await request(r2)).status === "pending" && (await row(lostOne.id)).status === "confirmed", "3b. the reply was lost: nothing recorded yet");
  await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: lostRefund!.charge as string }));
  const lostRow = await row(lostOne.id);
  const r2Row = await request(r2);
  check(lostRow.status === "cancelled" && lostRow.cancelled_by === "admin", `3c. the webhook records the cancellation (${lostRow.status})`);
  check(r2Row.status === "approved" && r2Row.decided_by === owner.id, `3d. ...and closes the request as approved by the owner (${r2Row.status})`);
  check(psqlValue(`select request_id from public.admin_actions where target = 'booking' and target_id = '${lostOne.id}' and action = 'cancel_booking'`) === r2,
    "3e. ...with the request on the booking's history");
  check((await refunds(lostOne.pi)).length === 1, "3f. one refund");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listing) {
    const bookings = `select id from public.bookings where listing_id = '${created.listing}'`;
    const requests = `select id from public.admin_requests where booking_id in (${bookings})`;
    psql(`set local session_replication_role = replica;
      delete from public.admin_notifications where admin_request_id in (${requests});
      delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where request_id in (${requests}));
      delete from public.admin_notifications where admin_action_id in (select id from public.admin_actions where target = 'booking' and target_id in (${bookings}));
      delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where target = 'booking' and target_id in (${bookings}));
      delete from public.admin_refund_holds where booking_id in (${bookings});
      delete from public.admin_actions where request_id in (${requests}) or (target = 'booking' and target_id in (${bookings}));
      delete from public.admin_requests where id in (${requests});
      delete from public.booking_emails where booking_id in (${bookings});
      delete from public.booking_events where booking_id in (${bookings});
      delete from public.notifications where booking_id in (${bookings});
      delete from public.booking_contacts where booking_id in (${bookings});
      delete from public.booking_finances where booking_id in (${bookings});
      delete from public.bookings where listing_id = '${created.listing}';
      delete from public.experience_sessions where listing_id = '${created.listing}';`);
    await db.from("listings").delete().eq("id", created.listing);
  }
  forgetTestAdmins();
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id).catch(() => undefined);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All request checks passed.");
process.exit(failures ? 1 : 0);
