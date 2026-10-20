// Every database function the apps read as JSON, against its schema
// (rpcJson in @repo/types, RPC_SHAPES; 2026-10-17), each called the way the
// apps call it and as the role that does, on the LOCAL stack, in "throw"
// mode: a function whose JSON drifts fails here by name and path. It also
// covers three reads nothing else runs: the admin's provider picker, the
// bookings page's money totals and "needs attention" counts, and the daily
// refresh-open-days job.
// Run: npx tsx supabase/tests/app/rpc-shapes.test.mts

import { execFileSync } from "node:child_process";
import { goLive } from "./_listings";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RPC_SHAPES, RpcShapeError, rpcJson, setRpcShapeCheck, type Database, type RpcJsonName } from "@repo/types";
import { runJob } from "../../../apps/website/server/utils/bookingJobs";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
setRpcShapeCheck("throw");
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const visitor = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const called = new Set<RpcJsonName>();
/** Calls `name` and reads it through its schema: a problem fails with the function's name and paths. */
async function read<N extends RpcJsonName>(client: SupabaseClient<Database>, name: N, args: Record<string, unknown> = {}) {
  called.add(name);
  const { data, error } = await (client.rpc as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  try {
    return rpcJson(name, data);
  } catch (e) {
    if (e instanceof RpcShapeError) check(false, `${name} matches its schema (${e.problems.join("; ")})`);
    throw e;
  }
}
const created = { users: [] as string[], provider: "", listings: [] as string[], category: "", expCategory: "", area: "" };

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  // Test logins on the local stack only, with a throwaway password.
  const password = randomBytes(18).toString("base64url");
  const login = async (label: string, admin = false) => {
    if (admin) {
      const a = await makeAdmin(local, `shapes-${label}-${run}@test.local`);
      created.users.push(a.id);
      return { id: a.id, email: a.email, client: a.client, server: a.server };
    }
    const { user } = await must(db.auth.admin.createUser({
      email: `shapes-${label}-${run}@test.local`, password, email_confirm: true,
    }));
    created.users.push(user.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, email: user.email!, client };
  };
  const owner = await login("provider");
  const customer = await login("customer");
  const admin = await login("admin", true);

  // A provider who can be paid, with hours, a live Service and Experience, a
  // session, and a booking of each kind: one paid, one a held request.
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: `Shapes ${run}`, city_id: atl.id }).select("id").single())).id;
  await must(db.from("providers").update({ stripe_account_id: `acct_test_shapes${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  await must(db.from("provider_weekly_hours").insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ provider_id: created.provider, weekday, starts: "08:00", ends: "20:00" }))));
  created.category = (await must(db.from("categories").insert({ kind: "service", name: `Shapes ${run}`, slug: `shapes-${run}` }).select("id").single())).id;
  created.expCategory = (await must(db.from("categories").insert({ kind: "experience", name: `Shapes walks ${run}`, slug: `shapes-walks-${run}` }).select("id").single())).id;
  const expCategory = created.expCategory;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Shapes ${run}` }).select("id").single())).id;
  const listing = async (kind: "service" | "experience", title: string) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: created.provider, city_id: atl.id, area_id: created.area, kind, category_id: kind === "service" ? created.category : expCategory,
      title: `${title} ${run}`, description: "A listing made by the JSON shapes test.", price_cents: 4000, duration_minutes: 60,
      location_mode: kind === "service" ? "provider_location" : null, booking_mode: kind === "service" ? "instant" : null,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A photo" }));
    await goLive(db, id);
    return id;
  };
  const service = await listing("service", "Shapes cut");
  const walk = await listing("experience", "Shapes walk");
  const session = (await must(db.from("experience_sessions").insert({ listing_id: walk, starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), capacity: 4 }).select("id").single())).id;
  const paid = (await must(db.rpc("reserve_experience_booking", {
    p_session_id: session, p_customer_id: customer.id, p_party_size: 2, p_customer_name: "Sam", p_customer_email: customer.email,
    p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 30 * 60_000).toISOString(),
  })) as { id: string }).id;
  await must(db.schema("private").from("booking_records").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: `pi_shapes_${run}` }).eq("id", paid));
  const slots = await read(visitor, "public_browse", { p_market: "atlanta", p_kind: "service", p_category: `shapes-${run}` });
  check(slots.ids.includes(service), "0. (the fixture's Service is live and visible)");
  await must(db.from("saved_listings").insert({ customer_id: customer.id, listing_id: service }));

  // 1. Public pages, as a visitor.
  await read(visitor, "public_browse", { p_market: "atlanta", p_kind: "experience" });
  const dated = new Date(Date.now() + 3 * 864e5);
  await read(visitor, "public_browse", { p_market: "atlanta", p_kind: "service", p_from: dated.toISOString(), p_to: new Date(dated.getTime() + 864e5).toISOString() });
  const counts = await read(visitor, "public_category_counts", { p_market_id: atl.id });
  check((counts[created.category] ?? 0) >= 1, "1a. category counts: numbers by category id");
  await read(visitor, "public_guides", { p_market: "atlanta" });
  check((await read(visitor, "public_guides", { p_market: `nowhere-${run}` })) === null, "1b. guides of a market that isn't public: null, as the schema allows");
  check((await read(visitor, "public_guide", { p_market: "atlanta", p_slug: `nothing-${run}` })) === null, "1c. a guide that doesn't exist: null");
  await read(visitor, "public_homepage_guides");
  check(true, "1d. the public functions match their schemas");

  // 2. Signed in: the customer's saved items and review state; the provider's sessions.
  const saved = await read(customer.client, "my_saved");
  check(saved.listings.some((l) => l.listing_id === service), "2a. my_saved: the customer's saved Service");
  const state = await read(customer.client, "review_state", { p_booking_id: paid });
  check(state?.role === "customer", "2b. review_state for the customer");
  const sessions = await read(owner.client, "listing_sessions_page", { p_listing_id: walk, p_past: false, p_page: 1, p_page_size: 50 });
  check(sessions.items[0]?.booked === 2, "2c. listing_sessions_page: the session's booked people");
  // A problem report about their Service, waiting for their reply.
  const report = (await must(db.from("support_reports").insert({
    provider_id: created.provider, category: "listing", description: "The shapes test's report about a listing.", listing_id: service,
  }).select("id").single())).id;
  await must(db.from("support_reports").update({ status: "waiting" }).eq("id", report).select("id"));
  const reports = await read(owner.client, "my_support_reports", { p_page: 1, p_page_size: 20 });
  check(reports.waiting === 1 && reports.rows[0]?.id === report && reports.rows[0]?.listing?.id === service && reports.rows[0]?.booking === null,
    "2d. my_support_reports: the provider's report, its listing, and the waiting count");

  // 3. The admin, including the three reads nothing else ran.
  const picker = await read(admin.client, "admin_providers_page", { p_q: `Shapes ${run}`, p_sort: "name", p_desc: false, p_page_size: 20 });
  check(picker.rows.some((p) => p.id === created.provider && !("owner_email" in p)), "3a. the provider picker's search: the provider, without its owner's email (step 5c)");
  // The day it was paid, from its own confirmed_at (the database's clock):
  // a day worked out from this process's clock is a day late if a run
  // crosses Atlanta midnight in between (found 2026-10-18).
  const { confirmed_at: paidAt } = await must(db.schema("private").from("booking_records").select("confirmed_at").eq("id", paid).single()) as { confirmed_at: string };
  const paidDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(paidAt));
  const money = await read(admin.client, "admin_bookings_page", { p_paid_from: paidDay, p_paid_to: paidDay, p_page_size: 1 });
  check(money.totals.charged_count >= 1 && money.totals.charged_cents >= 8000, "3b. the bookings page's money totals (the paid Experience)");
  const attention = await read(admin.client, "admin_bookings_page", { p_with_attention: true, p_page_size: 1 });
  check(attention.attention !== null && Object.keys(attention.attention).length === 5, "3c. ...and its five \"needs attention\" counts");
  await read(admin.client, "admin_listings_page", { p_kind: "service", p_page_size: 5 });
  await read(admin.client, "admin_reviews_page", { p_reported: false, p_page_size: 5 });
  const dashboard = await read(admin.client, "admin_dashboard");
  check(dashboard.open_reports >= 1, "3e. admin_dashboard: the open problem reports");
  const board = await read(admin.client, "admin_support_board", { p_q: `Shapes ${run}` });
  check(board.columns.waiting?.rows[0]?.id === report && board.columns.waiting.total === 1 && board.columns.todo?.total === 0,
    "3f. admin_support_board: every column, with the provider's report waiting");
  const one = await read(admin.client, "admin_support_board", { p_column: "waiting", p_page: 2, p_page_size: 1, p_q: `Shapes ${run}` });
  check(one.columns.waiting?.rows.length === 0 && one.columns.waiting.total === 1 && one.columns.todo === undefined,
    "3g. ...and one column's later page (\"Show more\")");
  await read(admin.client, "admin_ai_draft_cost", { p_since: new Date(Date.now() - 864e5).toISOString() });
  // Support's requests (admin roles, step 5b): the paid Experience's payout
  // held, support asks to release it; the owner's Requests page and approval read it.
  const support = await makeAdmin(local, `shapes-support-${run}@test.local`, { role: "support" });
  created.users.push(support.id);
  await must(db.schema("private").from("booking_records").update({ payout_hold: "refunded", payout_held_at: new Date().toISOString() }).eq("id", paid));
  const requestId = await must(support.client.rpc("admin_request_create", {
    p_kind: "release_payout", p_booking_id: paid, p_provider_id: null as unknown as string, p_reason: "The shapes test asks to release it.",
  })) as string;
  const requests = await read(admin.client, "admin_requests_page", { p_scope: "open", p_page_size: 100 });
  const mine = requests.rows.find((r) => r.id === requestId);
  check(!!mine && mine.booking?.id === paid && !!mine.booking.market_name && mine.requested_by_email === support.email,
    "3h. admin_requests_page: the booking's request, with its market and who asked");
  const forApproval = await read(admin.server, "admin_request_for_approval", { p_admin_id: admin.id, p_request_id: requestId });
  check(forApproval.kind === "release_payout" && forApproval.status === "pending" && forApproval.hold === "refunded",
    "3i. admin_request_for_approval: what approving it would run");
  // Contact views and limits (admin roles, step 5c): each through its schema.
  const contact = await read(admin.client, "admin_booking_contact", { p_booking_id: paid });
  check(!!contact.email, "3j. admin_booking_contact: the paid booking's email, recorded");
  const ownerEmail = await read(admin.client, "admin_provider_contact", { p_provider_id: created.provider });
  check(!!ownerEmail.email, "3k. admin_provider_contact: the owner's email, recorded");
  const myLimits = await read(admin.client, "admin_my_limits");
  check(myLimits.role === "owner" && myLimits.limited === false, "3l. admin_my_limits: the owner's, not limited");
  const views = await read(admin.client, "admin_contact_views_page", { p_admin_id: admin.id });
  check(views.total >= 2 && views.rows.some((r) => r.booking?.id === paid) && views.rows.some((r) => r.provider?.id === created.provider),
    "3m. admin_contact_views_page: both views, naming the booking and the provider");
  // Step 5d: the readiness checklist (here, the admin's read of a live
  // Experience) and the Activity page.
  const readiness = await read(admin.client, "listing_readiness", { p_listing_id: walk });
  check(readiness.map((i) => i.key).join(",") === "account,photos,address,sessions,payouts" && readiness.every((i) => i.key === "sessions" || i.done),
    "3n. listing_readiness: an Experience's checklist, in order, done but its sessions");
  const activity = await read(admin.client, "admin_activity_page", { p_page_size: 5 });
  check(activity.total >= 1 && activity.rows.length >= 1 && activity.rows.length <= 5, "3o. admin_activity_page: a page of the team's actions");
  // Step 5e: hiding a provider's headline, the queue, the provider's view,
  // and restoring it (text only: no files to move).
  await must(db.from("providers").update({ headline: "Shapes headline for the JSON test" }).eq("id", created.provider));
  const moves = await read(admin.server, "admin_hide_profile_content", {
    p_admin_id: admin.id, p_provider_id: created.provider, p_parts: ["headline"], p_rule: "abuse", p_reason: "The shapes test hides it.",
  });
  check(Array.isArray(moves) && moves.length === 0, "3p. admin_hide_profile_content: no photo files to move for a headline");
  const holds = await read(admin.client, "admin_profile_holds_page", { p_scope: "all", p_provider_id: created.provider });
  const hold = holds.rows.find((r) => r.part === "headline");
  check(!!hold && hold.held_text === "Shapes headline for the JSON test" && hold.status === "hidden" && hold.provider.id === created.provider,
    "3q. admin_profile_holds_page: the hidden headline, kept, with its provider");
  const mineHeld = await read(owner.client, "my_profile_holds");
  check(mineHeld.length === 1 && mineHeld[0]!.part === "headline" && !("reason" in mineHeld[0]!), "3r. my_profile_holds: the provider sees the part, not why");
  const work = await read(admin.server, "admin_decide_profile_hold", { p_admin_id: admin.id, p_hold_id: hold!.id, p_decision: "restore" });
  check(work === null, "3s. admin_decide_profile_hold: restoring a headline leaves no files to move");
  check(true, "3d. the admin functions match their schemas");

  // 4. The daily job, through its own code (the server key): this provider's
  // open days made two days old, so there's one to refresh.
  psql(`update public.service_open_days_refreshed set refreshed_at = now() - interval '2 days' where provider_id = '${created.provider}';`);
  const job = await runJob("refresh-open-days", db, null as never);
  called.add("refresh_stale_service_open_days");
  check(job.job === "refresh-open-days" && job.checked >= 1 && typeof job.moreWaiting === "boolean",
    `4. refresh-open-days reads its function through the schema (${job.done.join("; ") || "nothing due"})`);

  // 5. Nothing left out.
  const missing = (Object.keys(RPC_SHAPES) as RpcJsonName[]).filter((n) => !called.has(n));
  check(!missing.length, `5. every function with a schema was called here${missing.length ? ` (not: ${missing.join(", ")})` : ""}`);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  forgetTestAdmins();
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    psql(`set local session_replication_role = replica;
      delete from public.provider_profile_holds where provider_id = '${created.provider}';
      delete from public.provider_emails where provider_id = '${created.provider}';
      delete from public.admin_notifications where admin_request_id in (select id from public.admin_requests where booking_id in (select id from public.bookings where listing_id in (${ids})));
      delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where request_id in (select id from public.admin_requests where booking_id in (select id from public.bookings where listing_id in (${ids}))));
      delete from public.admin_actions where request_id in (select id from public.admin_requests where booking_id in (select id from public.bookings where listing_id in (${ids})));
      delete from public.admin_requests where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.admin_contact_views where booking_id in (select id from public.bookings where listing_id in (${ids})) or provider_id = '${created.provider}';
      delete from public.support_emails where report_id in (select id from public.support_reports where listing_id in (${ids}));
      delete from public.admin_notifications where report_id in (select id from public.support_reports where listing_id in (${ids}));
      delete from public.support_report_events where report_id in (select id from public.support_reports where listing_id in (${ids}));
      delete from public.support_reports where listing_id in (${ids});
      delete from public.saved_listings where listing_id in (${ids});
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where listing_id in (${ids});
      delete from public.booking_contacts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.provider_holds where provider_id = '${created.provider}';
      delete from public.bookings where listing_id in (${ids});
      delete from public.experience_sessions where listing_id in (${ids});
      delete from public.service_open_days where listing_id in (${ids});
      delete from public.service_open_days_refreshed where listing_id in (${ids});
      delete from public.listing_photos where listing_id in (${ids});
      delete from public.listing_addresses where listing_id in (${ids});
      delete from public.listing_service_areas where listing_id in (${ids});
      delete from public.listings where id in (${ids});`);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of [created.category, created.expCategory]) if (id) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All JSON shape checks passed.");
process.exit(failures ? 1 : 0);
