// What the admin does (apps/website/server/utils/adminBookings.ts; step 4
// part 8), against the LOCAL stack and the LOKL SANDBOX (test mode only),
// with real refunds, transfers and reversals: cancelling a request, a
// confirmed and a paid-out booking; resolving no-show reports both ways;
// releasing held payouts; sending an email again; suspending and
// reinstating a provider. Every action is logged with its reason, and
// running it twice changes nothing.
// Run: npx tsx supabase/tests/app/admin-actions.test.mts

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { adminCancelBooking, releasePayout, resolveProblemPaid, retryEmail, setProviderStatus } from "../../../apps/website/server/utils/adminBookings";
import { payOut } from "../../../apps/website/server/utils/bookingJobs";
import { providerCancel } from "../../../apps/website/server/utils/bookingCancellations";
import { providerMay } from "../../../apps/website/server/utils/providerAccess";
import { loadEmailContext, sendProviderEmails, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { renderEmail } from "../../../apps/website/server/utils/bookingEmailTemplates";

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
const connected = (await stripe.accounts.list({ limit: 100 })).data.find((a) => a.capabilities?.transfers === "active");
if (!connected) { console.error("Refusing to run: no connected test account in the Lokl sandbox can receive transfers."); process.exit(1); }

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const refused = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };
const row = async (id: string) => must(db.from("bookings").select("*").eq("id", id).single()) as Promise<Record<string, any>>;
const actions = async (targetId: string) => must(db.from("admin_actions").select("action, reason, admin_id").eq("target_id", targetId));
const emails = async (id: string) => ((await must(db.from("booking_emails").select("kind").eq("booking_id", id))) as { kind: string }[]).map((e) => e.kind);
const refundedInStripe = async (pi: string) => (await stripe.charges.list({ payment_intent: pi })).data[0]?.amount_refunded ?? -1;
// Test-only: move a booking into the past with the guard off (local database).
const happened = (id: string) => execFileSync("psql", [local.DB_URL!, "-q", "-c", `
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
    payout_due_at = now() + interval '23 hours', confirmed_at = now() - interval '3 days' where id = '${id}';
  alter table public.bookings enable trigger bookings_guard;`]);
const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], area: "" };
const day = 864e5;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string, appMeta: Record<string, unknown> = {}) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `admin-act-${label}-${run}@test.local`, email_confirm: true, app_metadata: appMeta }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const admin = await user("admin", { role: "admin" });
  const customer = await user("customer");
  const owner = await user("provider");
  const provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Admin Test", city_id: atl.id }).select("id").single())).id as string;
  created.providers.push(provider);
  await must(db.from("providers").update({ stripe_account_id: connected.id, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", provider));
  const svcCat = (await must(db.from("categories").insert({ kind: "service", name: `Admin svc ${run}`, slug: `admin-svc-${run}` }).select("id").single())).id;
  const expCat = (await must(db.from("categories").insert({ kind: "experience", name: `Admin exp ${run}`, slug: `admin-exp-${run}` }).select("id").single())).id;
  created.categories.push(svcCat, expCat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Admin ${run}` }).select("id").single())).id;
  const listing = async (kind: "service" | "experience") => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: provider, city_id: atl.id, area_id: created.area, status: "submitted", kind,
      category_id: kind === "service" ? svcCat : expCat, title: `Admin ${kind} ${run}`, description: "A listing made by the admin actions test.",
      price_cents: 5000, duration_minutes: 60, location_mode: kind === "service" ? "provider_location" : null,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const svc = await listing("service");
  const exp = await listing("experience");
  const session = async () => (await must(db.from("experience_sessions").insert({ listing_id: exp, starts_at: new Date(Date.now() + 3 * day).toISOString(), capacity: 10 }).select("id").single())).id as string;
  const paid = async () => {
    const b = await must(db.rpc("reserve_experience_booking", {
      p_session_id: await session(), p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"], metadata: { booking_id: b.id, test: "admin-actions" } });
    await must(db.from("bookings").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  };
  const dueAfter = async (id: string) => new Date(Date.parse((await row(id)).payout_due_at) + 60_000);

  // 1. A request: the hold is released, cancelled by lokl, logged with the reason.
  const reqId = (await must(db.rpc("create_service_request", {
    p_listing_id: svc, p_customer_id: customer.id, p_preferred_times: [new Date(Date.now() + 3 * day).toISOString()], p_customer_name: "Sam",
    p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
  })) as { id: string }).id;
  const hold = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true, payment_method_types: ["card"] });
  await must(db.from("bookings").update({ status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: hold.id, respond_by: new Date(Date.now() + 2 * day).toISOString() }).eq("id", reqId));
  check((await refused(() => adminCancelBooking(db, stripe, reqId, admin.id, "no"))).includes("Say why"), "1a. an admin action needs a reason");
  check((await adminCancelBooking(db, stripe, reqId, admin.id, "Duplicate request.")) === "cancelled and refunded", "1b. lokl cancels a request");
  check((await stripe.paymentIntents.retrieve(hold.id)).status === "canceled" && (await row(reqId)).cancelled_by === "admin", "1c. ...the hold is released, cancelled by lokl");
  check((await adminCancelBooking(db, stripe, reqId, admin.id, "Duplicate request.")) === "already cancelled", "1d. cancelling again changes nothing");
  const a1 = await actions(reqId);
  check(a1.length === 1 && a1[0]!.reason === "Duplicate request." && a1[0]!.admin_id === admin.id, "1e. ...and it's logged once, with the admin and the reason");

  // 2. A confirmed booking: refunded in full, and the provider is never paid for it.
  const conf = await paid();
  await adminCancelBooking(db, stripe, conf.id, admin.id, "The venue closed for repairs.");
  check((await refundedInStripe(conf.pi)) === 5000 && (await row(conf.id)).status === "cancelled", "2a. lokl cancels a confirmed booking: refunded $50.00 in full");
  await payOut(db, stripe, { bookingId: conf.id, now: await dueAfter(conf.id) });
  check(!(await row(conf.id)).stripe_transfer_id && (await emails(conf.id)).includes("provider_booking_cancelled"), "2b. ...the provider isn't paid, and both are emailed");

  // 3. After a payout: refunded, and the provider's transfer reversed.
  const out = await paid();
  happened(out.id);
  await payOut(db, stripe, { bookingId: out.id, now: await dueAfter(out.id) });
  const outRow = await row(out.id);
  check(outRow.status === "paid_out" && !!outRow.stripe_transfer_id, "3a. (set-up) the booking is paid out with a real transfer");
  const r3 = await adminCancelBooking(db, stripe, out.id, admin.id, "Customer complaint upheld.");
  const after3 = await row(out.id);
  const transfer = await stripe.transfers.retrieve(outRow.stripe_transfer_id);
  check(r3 === "cancelled and refunded" && after3.status === "cancelled" && !!after3.stripe_transfer_reversal_id, "3b. lokl cancels after the payout");
  check((await refundedInStripe(out.pi)) === 5000 && transfer.amount_reversed === transfer.amount, "3c. ...the customer is refunded and the provider's whole transfer reversed");
  const { ctx: outCtx } = await loadEmailContext(db, out.id, "http://localhost:3100");
  check((await emails(out.id)).includes("provider_booking_cancelled") && renderEmail("provider_booking_cancelled", outCtx).text.includes("has been taken back from your Stripe balance"),
    "3d. ...and the provider's email says their share was taken back");

  // 4. A no-show report resolved in the provider's favour: the payout goes ahead.
  const ns = await paid();
  happened(ns.id);
  await must(db.from("bookings").update({ problem_reported_at: new Date().toISOString(), problem_note: "Nobody was there at all.", payout_hold: "problem_reported", payout_held_at: new Date().toISOString() }).eq("id", ns.id));
  check((await refused(() => releasePayout(db, stripe, ns.id, admin.id, "Looks fine to me."))).includes("resolve the report"), "4a. a reported no-show isn't simply released; it's resolved");
  check((await resolveProblemPaid(db, stripe, ns.id, admin.id, "The provider sent photos from the meeting point.")) === "resolved: the provider will be paid", "4b. resolved in the provider's favour");
  const ns1 = await row(ns.id);
  check(ns1.problem_resolution === "paid_provider" && !ns1.payout_hold && (await emails(ns.id)).includes("provider_problem_paid"), "4c. ...the hold is cleared and the provider is told");
  await payOut(db, stripe, { bookingId: ns.id, now: await dueAfter(ns.id) });
  check((await row(ns.id)).status === "paid_out", "4d. ...and it's paid out when due");
  check((await refused(() => resolveProblemPaid(db, stripe, ns.id, admin.id, "Again, by mistake."))).includes("no open report"), "4e. a report is resolved once");

  // 5. A no-show report resolved with a refund: cancelled, refunded, the report's own emails.
  const nr = await paid();
  happened(nr.id);
  await must(db.from("bookings").update({ problem_reported_at: new Date().toISOString(), problem_note: "Nobody was there at all.", payout_hold: "problem_reported", payout_held_at: new Date().toISOString() }).eq("id", nr.id));
  await adminCancelBooking(db, stripe, nr.id, admin.id, "The provider confirmed they missed it.", { resolveProblem: true });
  const nr1 = await row(nr.id);
  const nrEmails = await emails(nr.id);
  check(nr1.status === "cancelled" && nr1.problem_resolution === "refunded" && (await refundedInStripe(nr.pi)) === 5000, "5a. resolved with a full refund, and the booking cancelled");
  check(nrEmails.includes("customer_problem_refunded") && nrEmails.includes("provider_problem_refunded") && !nrEmails.includes("customer_booking_cancelled"),
    "5b. ...both hear the report's outcome, not a plain cancellation");
  check((await actions(nr.id))[0]?.action === "resolve_problem_refunded", "5c. ...logged as a report resolved with a refund");

  // 6. Releasing a held payout: paid when due; not while a dispute is open.
  const held = await paid();
  happened(held.id);
  await must(db.from("bookings").update({ status: "completed", status_changed_by: "system" }).eq("id", held.id));
  await must(db.from("bookings").update({ payout_hold: "account_cannot_receive", payout_held_at: new Date().toISOString() }).eq("id", held.id));
  check((await releasePayout(db, stripe, held.id, admin.id, "Their account is fixed now.")).length > 0 && !(await row(held.id)).payout_hold, "6a. a hold is released");
  await payOut(db, stripe, { bookingId: held.id, now: await dueAfter(held.id) });
  check((await row(held.id)).status === "paid_out", "6b. ...and the payout goes out when due");
  const disputed = await paid();
  await must(db.from("bookings").update({ payout_hold: "dispute", payout_held_at: new Date().toISOString(), disputed_at: new Date().toISOString(), stripe_dispute_id: "dp_test" }).eq("id", disputed.id));
  check((await refused(() => releasePayout(db, stripe, disputed.id, admin.id, "Trying to release it."))).includes("dispute is still open"), "6c. a payout held by an open dispute can't be released");

  // 7. Sending an email again.
  const [anEmail] = await must(db.from("booking_emails").select("id").eq("booking_id", conf.id).limit(1)) as { id: string }[];
  await must(db.from("booking_emails").update({ status: "failed", last_error: "Resend 500: test" }).eq("id", anEmail!.id));
  await retryEmail(db, anEmail!.id, admin.id);
  const again = await must(db.from("booking_emails").select("status, attempts, last_error").eq("id", anEmail!.id).single()) as Record<string, any>;
  check(again.status === "pending" && again.attempts === 0 && !again.last_error && (await actions(anEmail!.id)).length === 1, "7a. a failed email goes back in the queue, logged");
  check((await refused(() => retryEmail(db, anEmail!.id, admin.id))).includes("Only a failed or skipped email"), "7b. an email that's already queued isn't queued twice");

  // 8. Suspending and reinstating a provider.
  const openReq = (await must(db.rpc("create_service_request", {
    p_listing_id: svc, p_customer_id: customer.id, p_preferred_times: [new Date(Date.now() + 4 * day).toISOString()], p_customer_name: "Sam",
    p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
  })) as { id: string }).id;
  const hold2 = await stripe.paymentIntents.create({ amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true, payment_method_types: ["card"] });
  await must(db.from("bookings").update({ status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: hold2.id, respond_by: new Date(Date.now() + 2 * day).toISOString() }).eq("id", openReq));
  check((await refused(() => setProviderStatus(db, stripe, provider, "suspended", admin.id, "x"))).includes("Say why"), "8a. suspending needs a reason");
  // A confirmed booking that should survive the suspension.
  const keep = await paid();
  const s1 = await setProviderStatus(db, stripe, provider, "suspended", admin.id, "Several customers reported no-shows.", "Please call us about the last two bookings.");
  check(s1.startsWith("suspended") && (await row(openReq)).status === "declined" && (await stripe.paymentIntents.retrieve(hold2.id)).status === "canceled",
    "8b. a suspended provider's open requests are withdrawn at once, holds released");
  check((await setProviderStatus(db, stripe, provider, "suspended", admin.id, "Several customers reported no-shows.")) === "already suspended", "8c. suspending again changes nothing");

  // 9. The "paused" email: once, with lokl's message, never the internal reason.
  const sentToProvider: OutgoingEmail[] = [];
  const fake = { async send(e: OutgoingEmail) { sentToProvider.push(e); return { id: `re_test_${sentToProvider.length}` }; } };
  const settings = { mode: "allowlist" as const, allowlist: [owner.email], from: "lokl <lokl@innatetheory.com>", replyTo: "replies@example.com", siteUrl: "http://localhost:3100" };
  await sendProviderEmails(db, fake, settings, { providerId: provider });
  const pausedEmail = sentToProvider[0];
  check(sentToProvider.length === 1 && pausedEmail?.subject === "Your lokl account is paused" && pausedEmail.to === owner.email,
    "9a. suspending emails the provider \"Your lokl account is paused\", once (suspending twice didn't add one)");
  check(!!pausedEmail?.text.includes("Please call us about the last two bookings.") && !pausedEmail.text.includes("reported no-shows") && !pausedEmail.html.includes("reported no-shows"),
    "9b. ...with lokl's message, and never the internal reason");
  const logged = (await actions(provider)).find((a) => a.action === "suspend_provider");
  check(logged?.reason === "Several customers reported no-shows.", "9c. the internal reason is kept in the admin log");

  // 10. A suspended provider can still see and cancel their confirmed bookings, and nothing else.
  check(providerMay("suspended", "view_bookings") && providerMay("suspended", "cancel_bookings"), "10a. a suspended provider may still see and cancel bookings");
  check(!providerMay("suspended", "answer_requests") && !providerMay("suspended", "edit_listings") && !providerMay("suspended", "manage_payouts") && !providerMay("suspended", "other"),
    "10b. ...but not answer requests, edit listings or set up payouts");
  check(["view_bookings", "cancel_bookings", "answer_requests", "edit_listings", "manage_payouts", "other"].every((a) => providerMay("active", a as any)), "10c. an active provider may do everything");
  check((await row(keep.id)).status === "confirmed", "10d. the confirmed booking survived the suspension");
  check((await providerCancel(db, stripe, keep.id, "I'm not able to run it, sorry.")) === "cancelled, refunded in full" && (await refundedInStripe(keep.pi)) === 5000,
    "10e. the suspended provider cancels it, and the customer gets the usual full refund");
  // The routes ask for those actions, so a suspended provider gets through
  // exactly there (and nowhere else that's provider-only).
  const route = (f: string) => fs.readFileSync(new URL(`../../../apps/website/server/${f}`, import.meta.url), "utf8");
  check(route("api/provider/bookings/index.get.ts").includes('requireProvider(event, "view_bookings")')
    && route("api/provider/bookings/[id].get.ts").includes('requireProvider(event, "view_bookings")'),
    "10f. the provider's bookings pages let a suspended provider in");
  check(route("api/bookings/[id]/cancel.post.ts").includes('providerMay(provider.status, "cancel_bookings")')
    && route("api/sessions/[id]/cancel.post.ts").includes('requireProvider(event, "cancel_bookings")'),
    "10g. cancelling a booking or a session lets a suspended provider through");
  check(route("utils/providerBookings.ts").includes('requireProvider(event, "answer_requests")')
    && ["api/listings/[id]/publish.post.ts", "api/listings/[id]/submit.post.ts", "api/provider/stripe/onboard.post.ts"].every((f) => route(f).includes("requireProvider(event)")),
    "10h. answering requests, listings and Stripe setup still refuse a suspended provider");
  check((await setProviderStatus(db, stripe, provider, "active", admin.id, "Spoke to them; it's resolved.")) === "reinstated", "8d. a provider is reinstated");
  await sendProviderEmails(db, fake, settings, { providerId: provider });
  check(sentToProvider.length === 2 && sentToProvider[1]!.subject === "Your lokl account is active again" && !sentToProvider[1]!.text.includes("A message from lokl"),
    "8f. reinstating emails \"Your lokl account is active again\" (no message written, so none included)");
  const pa = await actions(provider);
  check(pa.map((a) => a.action).sort().join() === "reinstate_provider,suspend_provider" && pa.every((a) => a.reason && a.admin_id === admin.id), "8e. both are logged with the admin and the reason");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from admin_actions where target_id in (select id from bookings where listing_id in (${ids})) or target_id in (select id from booking_emails where booking_id in (select id from bookings where listing_id in (${ids})));
      delete from provider_emails where provider_id in (${created.providers.map((p) => `'${p}'`).join(",") || "null"});
      delete from admin_actions where target_id in (${created.providers.map((p) => `'${p}'`).join(",") || "null"});
      delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from experience_sessions where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All admin action checks passed.");
process.exit(failures ? 1 : 0);
