// Money actions retried after a lost reply, or finished by Stripe's webhook
// when nobody retries (the lost-reply check, 2026-10-11). Each part does
// the Stripe step itself, as the action would (with its metadata: what the
// step means for lokl), then retries the action, or sends Stripe's event
// to the payments webhook handler, and checks the booking ends up right,
// with money moved once. Also Stripe's "already done" refusals, with a
// stand-in Stripe that refuses, and a released hold's meaning.
// Runs the routes' own code against the LOCAL stack and the LOKL SANDBOX.
// Run: npx tsx supabase/tests/app/money-retries.test.mts

import { execFileSync } from "node:child_process";
import { goLive } from "./_listings";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { safeStripe, STRIPE_CLIENT_OPTIONS } from "@repo/types";
import { stripeTestKey } from "./_stripeKey";
import { acceptRequest, declineRequest } from "../../../apps/website/server/utils/bookingAnswers";
import { cancelSession, customerCancel, providerCancel, refundInFull, reverseTransfer } from "../../../apps/website/server/utils/bookingCancellations";
import { adminCancelBooking } from "../../../apps/website/server/utils/adminBookings";
import { expireRequests } from "../../../apps/website/server/utils/bookingJobs";
import { handlePaymentsEvent } from "../../../apps/website/server/utils/bookings";
import { slotAfter } from "./_slots";
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
// The SQL goes on standard input: Linux caps one command-line argument at 128 KB.
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
async function part(name: string, work: () => Promise<void>) {
  try { await work(); } catch (e) { failures++; console.error(`FAIL ${name} stopped: ${(e as Error).message}`); }
}
const row = async (id: string) => must(db.schema("private").from("booking_records").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const refunds = async (pi: string) => (await stripe.refunds.list({ payment_intent: pi })).data;
const event = (type: string, object: { id: string }) => ({ id: `evt_test_${randomUUID()}`, type, data: { object } }) as unknown as Stripe.Event;
const adminLogs = (bookingId: string) => execFileSync("psql", [local.DB_URL!, "-X", "-At", "-c", `select count(*) from public.admin_actions where target = 'booking' and target_id = '${bookingId}'`], { encoding: "utf8" }).trim();
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };
const day = 864e5;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string, admin = false) => {
    if (admin) {
      const a = await makeAdmin(local, `retry-money-${label}-${run}@test.local`);
      created.users.push(a.id);
      return { id: a.id, email: a.email, server: a.server };
    }
    const { user: u } = await must(db.auth.admin.createUser({ email: `retry-money-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  const admin = await user("admin", true);
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Retry Money", city_id: atl.id }).select("id").single())).id;
  await must(db.from("providers").update({ stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Money svc ${run}`, slug: `money-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Money exp ${run}`, slug: `money-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Money ${run}` }).select("id").single())).id;
  const listing = async (kind: "service" | "experience") => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: created.provider, city_id: atl.id, area_id: created.area, kind,
      category_id: kind === "service" ? svcCat : expCat, title: `Money ${kind} ${run}`, description: "A listing made by the money retries test.",
      price_cents: 5000, duration_minutes: 60, location_mode: kind === "service" ? "provider_location" : null, booking_mode: kind === "service" ? "approve" : null,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await goLive(db, id);
    return id;
  };
  const svc = await listing("service");
  const exp = await listing("experience");
  // Each session 2 hours after the last: one provider's sessions can't
  // overlap (service_availability), and these are an hour long. They start
  // six days out, clear of the Service requests' slots (from three days).
  let sessions = 0;
  const session = async (startsInHours: number) =>
    (await must(db.from("experience_sessions").insert({ listing_id: exp, starts_at: new Date(Date.now() + (startsInHours + 2 * sessions++) * 3600_000).toISOString(), capacity: 6 }).select("id").single())).id as string;
  // A Service request with the card held, as checkout leaves it.
  const request = async (inDays = 3) => {
    // Its time: the slot booked (Services are booked from slots).
    const t = await slotAfter(db, svc, inDays * day);
    const b = (await must(db.rpc("create_service_booking", {
    p_listing_id: svc, p_customer_id: customer.id, p_starts_at: t, p_customer_name: "Sam",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string });
    const pi = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true, payment_method_types: ["card"], metadata: { booking_id: b.id } });
    await must(db.schema("private").from("booking_records").update({ status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, respond_by: new Date(Date.now() + 2 * day).toISOString() }).eq("id", b.id));
    return { id: b.id, pi: pi.id, time: t };
  };
  // A paid Experience booking, as checkout leaves it.
  const paid = async (sessionId: string) => {
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"], metadata: { booking_id: b.id } });
    await must(db.schema("private").from("booking_records").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };
  // What the accept route writes on the capture: an accept, and when the provider accepted.
  const accepting = (r: { id: string; time: string }) =>
    ({ booking_id: r.id, lokl_action: "accept", accepted_at: new Date().toISOString() });
  // Captured in time: the answer-by time is set a second after the accept, then passes.
  const answeredInTime = async (r: { id: string; pi: string; time: string }) => {
    const meta = accepting(r);
    await stripe.paymentIntents.capture(r.pi, { metadata: meta });
    setTimes(r.id, `respond_by = '${meta.accepted_at}'::timestamptz + interval '1 second'`);
    await new Promise((done) => setTimeout(done, 1500));
  };
  // Test-only, guards off (local database): move a booking's times.
  const setTimes = (id: string, sql: string) => psql(`set local session_replication_role = replica; update public.bookings set ${sql} where id = '${id}';`);
  // The Stripe step of a cancellation, as the action takes it: the reason saved first, then the refund with its meaning.
  const refundAsCancel = async (b: { id: string; pi: string }, by: string, extra: Record<string, string> = {}, reason = "The venue closed for the day.") => {
    setTimes(b.id, `cancel_reason = '${reason}'`);
    return stripe.refunds.create({ payment_intent: b.pi, metadata: { booking_id: b.id, lokl_action: "cancel", cancelled_by: by, ...extra } });
  };

  // 1. Accepting: the card was captured, the confirmation never written.
  await part("part 1", async () => {
    const r = await request();
    await stripe.paymentIntents.capture(r.pi, { metadata: accepting(r) });
    check((await acceptRequest(db, stripe, r.id)) === "accepted" && (await row(r.id)).status === "confirmed", "1a. a retry confirms it");
    const pi = await stripe.paymentIntents.retrieve(r.pi);
    check(pi.amount_received === 5000 && (await refunds(r.pi)).length === 0, "1b. ...charged once, nothing refunded");
    // Nobody retries: Stripe's payment_intent.succeeded finishes it.
    const r2 = await request();
    const captured = await stripe.paymentIntents.capture(r2.pi, { metadata: accepting(r2) });
    await handlePaymentsEvent(db, stripe, event("payment_intent.succeeded", captured));
    const b2 = await row(r2.id);
    check(b2.status === "confirmed" && Date.parse(b2.starts_at) === Date.parse(r2.time), "1c. with nobody retrying, the payment webhook confirms it at the chosen time");
  });

  // 2. Accepting, the answer-by time passed before anyone retried.
  await part("part 2", async () => {
    const r = await request();
    await answeredInTime(r);
    const result = await acceptRequest(db, stripe, r.id).catch((e) => (e as Error).message);
    check(result === "accepted" && (await row(r.id)).status === "confirmed", `2a. captured in time, retried after the answer-by time: confirmed (${result})`);
    // Nobody retries: expire-requests finds the capture and confirms it.
    const r2 = await request();
    await answeredInTime(r2);
    await expireRequests(db, stripe, { bookingId: r2.id });
    check((await row(r2.id)).status === "confirmed", "2b. with nobody retrying, expire-requests confirms a captured request");
    // Its time has passed too: refunded instead. (Written directly: a booked
    // time never changes, so only the test can move it into the past.)
    const r3 = await request();
    await stripe.paymentIntents.capture(r3.pi, { metadata: accepting(r3) });
    setTimes(r3.id, `respond_by = now() - interval '2 hours', starts_at = now() - interval '1 hour', ends_at = now()`);
    await expireRequests(db, stripe, { bookingId: r3.id });
    const b3 = await row(r3.id);
    check(b3.status === "expired" && b3.refunded_cents === 5000 && (await refunds(r3.pi)).length === 1, "2c. captured but its time has passed: refunded in full, once, and the request ends");
  });

  // 3. Declining: the hold was released, the answer never written.
  await part("part 3", async () => {
    const r = await request();
    await stripe.paymentIntents.update(r.pi, { metadata: { lokl_release: "decline" } });
    const cancelled = await stripe.paymentIntents.cancel(r.pi);
    await handlePaymentsEvent(db, stripe, event("payment_intent.canceled", cancelled));
    const b = await row(r.id);
    check(b.status === "declined" && b.status_changed_by === "provider", `3. with nobody retrying, the webhook records it as declined by the provider, not expired (${b.status})`);
  });

  // 4. A customer's cancellation: refunded in full, never recorded.
  await part("part 4", async () => {
    const b = await paid(await session(144));
    await refundAsCancel(b, "customer");
    check((await customerCancel(db, stripe, b.id)) === "cancelled, refunded in full" && (await refunds(b.pi)).length === 1, "4a. a retry records the cancellation, refunded once");
    // Refunded in time, retried after the 48-hour line: still a full refund.
    // (Stripe's clock can't be moved: the start is moved to 48 hours and a
    // second after the refund, and the retry waits for that second to pass.)
    const late = await paid(await session(144));
    setTimes(late.id, "confirmed_at = now() - interval '5 days', created_at = now() - interval '6 days'");
    const lateRefund = await refundAsCancel(late, "customer");
    const lineAt = lateRefund.created + 48 * 3600 + 1;
    setTimes(late.id, `starts_at = to_timestamp(${lineAt}), ends_at = to_timestamp(${lineAt + 3600}), payout_due_at = to_timestamp(${lineAt + 90000})`);
    await new Promise((r) => setTimeout(r, 2500));
    const result = await customerCancel(db, stripe, late.id);
    const l = await row(late.id);
    check(result === "cancelled, refunded in full" && l.refunded_cents === 5000, `4b. refunded before the 48-hour line, retried after it: recorded as refunded in full (${result}, ${l.refunded_cents})`);
    // Nobody retries: Stripe's charge.refunded finishes it.
    const quiet = await paid(await session(144));
    const refund = await refundAsCancel(quiet, "customer");
    await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: refund.charge as string }));
    const q = await row(quiet.id);
    check(q.status === "cancelled" && q.cancelled_by === "customer" && q.refunded_cents === 5000, `4c. with nobody retrying, the refund webhook records the customer's cancellation (${q.status})`);
  });

  // 5. A provider's cancellation, refunded before the start, retried after it.
  await part("part 5", async () => {
    const b = await paid(await session(144));
    const refund = await refundAsCancel(b, "provider");
    setTimes(b.id, `starts_at = to_timestamp(${refund.created + 1}), ends_at = to_timestamp(${refund.created + 3601}), payout_due_at = to_timestamp(${refund.created + 90000})`);
    await new Promise((r) => setTimeout(r, 2500));
    const result = await providerCancel(db, stripe, b.id, "The venue closed for the day.").catch((e) => (e as Error).message);
    check(result === "cancelled, refunded in full" && (await row(b.id)).status === "cancelled", `5. refunded before the start, retried after it: cancelled (${result})`);
  });

  // 6. Cancelling a session: one booking refunded, then the rest stopped.
  await part("part 6", async () => {
    const s = await session(144);
    const a = await paid(s);
    const b = await paid(s);
    psql(`update public.experience_sessions set status = 'cancelled' where id = '${s}';`);
    await refundAsCancel(a, "provider");
    await cancelSession(db, stripe, s, "The venue closed for the day.");
    check((await row(a.id)).status === "cancelled" && (await row(b.id)).status === "cancelled", "6a. a retry cancels every booking on the session");
    check((await refunds(a.pi)).length === 1 && (await refunds(b.pi)).length === 1, "6b. ...each refunded once");
    // Nobody retries: the refund webhook finishes the one refunded.
    const s2 = await session(152);
    const c = await paid(s2);
    psql(`update public.experience_sessions set status = 'cancelled' where id = '${s2}';`);
    const refund = await refundAsCancel(c, "provider", { lokl_action: "cancel_session" });
    await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: refund.charge as string }));
    const cc = await row(c.id);
    check(cc.status === "cancelled" && cc.cancel_reason === "The venue closed for the day.", `6c. with nobody retrying, the refund webhook cancels it with the provider's reason (${cc.status})`);
  });

  // 7. The admin's refund: Stripe done, the booking and the log never written.
  await part("part 7", async () => {
    const b = await paid(await session(144));
    await refundAsCancel(b, "admin", { admin_id: admin.id });
    check((await adminCancelBooking(admin.server, stripe, b.id, admin.id, "The venue closed for the day.")) === "cancelled and refunded", "7a. a retry cancels it");
    check((await refunds(b.pi)).length === 1 && adminLogs(b.id) === "1", "7b. ...refunded once, logged once");
    // Cancelled, but the log never written: a retry writes it.
    const unlogged = await paid(await session(144));
    await refundAsCancel(unlogged, "admin", { admin_id: admin.id });
    setTimes(unlogged.id, "status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), refunded_cents = 5000, refunded_at = now(), status_changed_by = 'admin'");
    const again = await adminCancelBooking(admin.server, stripe, unlogged.id, admin.id, "The venue closed for the day.");
    check(again === "already cancelled" && adminLogs(unlogged.id) === "1", `7c. already cancelled with no log: the retry logs it (${adminLogs(unlogged.id)} logged)`);
    // Nobody retries: the refund webhook cancels and logs it.
    const quiet = await paid(await session(144));
    const refund = await refundAsCancel(quiet, "admin", { admin_id: admin.id });
    await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: refund.charge as string }));
    const q = await row(quiet.id);
    check(q.status === "cancelled" && q.cancelled_by === "admin" && adminLogs(quiet.id) === "1", `7d. with nobody retrying, the refund webhook cancels and logs it (${q.status}, ${adminLogs(quiet.id)} logged)`);
  });

  // 8. Stripe's "already done" refusals are treated as done (a stand-in Stripe).
  await part("part 8", async () => {
    const refused = (code: string) => Object.assign(new Error("This charge has already been refunded."), { type: "StripeInvalidRequestError", code });
    const fullyRefunded = {
      paymentIntents: { retrieve: async () => ({ id: "pi_x", status: "succeeded", latest_charge: { amount: 5000, amount_refunded: 0 } }) },
      refunds: { create: async () => { throw refused("charge_already_refunded"); } },
      charges: { retrieve: async () => ({ amount: 5000, amount_refunded: 5000 }) },
    } as unknown as Stripe;
    // A real booking of this test's (each money-moving call reads its attempt number).
    const some = (await must(db.from("bookings").select("id").in("listing_id", created.listings).limit(1).single())) as { id: string };
    const refundedNow = await refundInFull(db, fullyRefunded, { id: some.id, stripe_payment_intent_id: "pi_x", total_cents: 5000 } as never).catch((e) => (e as Error).message);
    check(refundedNow === 5000, `8a. a refund Stripe refuses as already done counts as done (${refundedNow})`);
    const attempt = await db.schema("private").from("stripe_attempts").select("attempt").eq("booking_id", some.id).eq("action", "refund").maybeSingle();
    check(attempt.data?.attempt === 1, `8a2. ...and isn't counted as a refusal: the next refund keeps its key (attempt ${attempt.data?.attempt})`);
    // A real refusal (the charge isn't refunded): the next try gets a new key.
    const refusing = {
      paymentIntents: { retrieve: async () => ({ id: "pi_x", status: "succeeded", latest_charge: { id: "ch_x", amount: 5000, amount_refunded: 0 } }) },
      refunds: { create: async () => { throw refused("charge_disputed"); } },
      charges: { retrieve: async () => ({ amount: 5000, amount_refunded: 0 }) },
    } as unknown as Stripe;
    await refundInFull(db, refusing, { id: some.id, stripe_payment_intent_id: "pi_x", total_cents: 5000 } as never).catch(() => null);
    const raised = await db.schema("private").from("stripe_attempts").select("attempt").eq("booking_id", some.id).eq("action", "refund").maybeSingle();
    check(raised.data?.attempt === 2, `8a3. a refund Stripe definitely refuses moves the next try to a new key (attempt ${raised.data?.attempt})`);
    const fullyReversed = {
      transfers: {
        retrieve: (() => { let n = 0; return async () => (n++ === 0 ? { id: "tr_x", amount: 4000, amount_reversed: 0 } : { id: "tr_x", amount: 4000, amount_reversed: 4000 }); })(),
        createReversal: async () => { throw Object.assign(new Error("The transfer has already been fully reversed."), { type: "StripeInvalidRequestError" }); },
        listReversals: async () => ({ data: [{ id: "trr_x" }] }),
      },
    } as unknown as Stripe;
    const reversed = await reverseTransfer(db, fullyReversed, { id: some.id, stripe_transfer_id: "tr_x" });
    check("id" in reversed && reversed.id === "trr_x", `8b. a reversal Stripe refuses as already done counts as done (${JSON.stringify(reversed)})`);
  });

  // 9. A request's hold released by lokl, the reply lost: the webhook records what it meant.
  await part("part 9", async () => {
    const r = await request();
    await stripe.paymentIntents.update(r.pi, { metadata: { lokl_release: "cancel", cancelled_by: "customer" } });
    await handlePaymentsEvent(db, stripe, event("payment_intent.canceled", await stripe.paymentIntents.cancel(r.pi)));
    const c = await row(r.id);
    check(c.status === "cancelled" && c.cancelled_by === "customer", `9a. the customer's cancelled request is recorded as theirs (${c.status})`);
    const r2 = await request();
    setTimes(r2.id, "cancel_reason = 'The provider asked us to.'");
    await stripe.paymentIntents.update(r2.pi, { metadata: { lokl_release: "cancel", cancelled_by: "admin", admin_id: admin.id } });
    await handlePaymentsEvent(db, stripe, event("payment_intent.canceled", await stripe.paymentIntents.cancel(r2.pi)));
    const a2 = await row(r2.id);
    check(a2.status === "cancelled" && a2.cancelled_by === "admin" && adminLogs(r2.id) === "1", `9b. lokl's cancelled request is recorded and logged (${a2.status}, ${adminLogs(r2.id)} logged)`);
  });

  // 10. The real actions, with the database write lost after Stripe acted:
  // what they write to Stripe is enough to finish them.
  // A stand-in database that "crashes" on the status change (or lokl's cancel
  // function). An admin's action goes through their own session's server
  // client (`base`), as the route's does: the refund limit is checked
  // before Stripe, for that session (admin roles, step 5b).
  const crashing = (writes: string, base: typeof db = db) => new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "rpc") return (fn: string, args: unknown) => {
        if (fn === writes) throw new Error("the server stopped before the database write");
        return target.rpc(fn as never, args as never);
      };
      if (prop !== "schema") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const schema = target.schema(name as never);
        return new Proxy(schema, {
          get(st, sp, sr) {
            if (sp !== "from") return Reflect.get(st, sp, sr);
            return (table: string) => {
              const q = st.from(table);
              return new Proxy(q, {
                get(qt, qp, qr) {
                  if (qp === "update") return (values: Record<string, unknown>) => {
                    if (values.status === writes) throw new Error("the server stopped before the database write");
                    return qt.update(values);
                  };
                  return Reflect.get(qt, qp, qr);
                },
              });
            };
          },
        });
      };
    },
  }) as typeof db;
  const lost = async (work: Promise<unknown>) => { await work.then(() => "", (e) => (e as Error).message); };

  await part("part 10", async () => {
    const r = await request();
    await lost(acceptRequest(crashing("confirmed"), stripe, r.id));
    await handlePaymentsEvent(db, stripe, event("payment_intent.succeeded", await stripe.paymentIntents.retrieve(r.pi)));
    check((await row(r.id)).status === "confirmed", "10a. the accept's capture says enough for the webhook to confirm it");
    const d = await request();
    await lost(declineRequest(crashing("declined"), stripe, d.id));
    await handlePaymentsEvent(db, stripe, event("payment_intent.canceled", await stripe.paymentIntents.retrieve(d.pi)));
    const dd = await row(d.id);
    check(dd.status === "declined" && dd.status_changed_by === "provider", `10b. the decline's release says enough for the webhook (${dd.status})`);
    const c = await paid(await session(144));
    await lost(customerCancel(crashing("cancelled"), stripe, c.id));
    const cr = (await refunds(c.pi))[0]!;
    await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: cr.charge as string }));
    check((await row(c.id)).cancelled_by === "customer", "10c. the customer's refund says enough for the webhook");
    const a = await paid(await session(144));
    await lost(adminCancelBooking(crashing("admin_cancel_booking", admin.server as typeof db), stripe, a.id, admin.id, "The venue closed for the day."));
    const ar = (await refunds(a.pi))[0]!;
    await handlePaymentsEvent(db, stripe, event("charge.refunded", { id: ar.charge as string }));
    const aa = await row(a.id);
    check(aa.cancelled_by === "admin" && aa.cancel_reason === "The venue closed for the day." && adminLogs(a.id) === "1",
      `10d. lokl's refund says enough for the webhook, with the reason and the log (${aa.status}, ${adminLogs(a.id)} logged)`);
    // Accepted (the reply lost), then a decline is tried: the release fails,
    // and must not erase what the capture meant.
    const e = await request();
    await lost(acceptRequest(crashing("confirmed"), stripe, e.id));
    await lost(declineRequest(db, stripe, e.id));
    setTimes(e.id, "respond_by = now() - interval '1 second'");
    await expireRequests(db, stripe, { bookingId: e.id });
    check((await row(e.id)).status === "confirmed", `10e. a failed decline after a lost accept doesn't erase the accept (${(await row(e.id)).status})`);
  });
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  forgetTestAdmins();
  if (created.listings.length) {
    const ids = created.listings.map((id) => `'${id}'`).join(",");
    psql(`set local session_replication_role = replica;
      delete from public.admin_actions where target = 'booking' and target_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_contacts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from private.stripe_attempts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.bookings where listing_id in (${ids});`);
  }
  for (const id of created.listings) await db.from("listings").delete().eq("id", id);
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All money retry checks passed.");
process.exit(failures ? 1 : 0);
