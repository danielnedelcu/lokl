// Booking finances can't leak through the API (migration booking_finances):
// a signed-out visitor, a customer and a provider each try, with the
// publishable key and their own sign-in, to read private.booking_records,
// booking_finances, booking_reports and the old columns on bookings.
// (pgTAP's booking_finances test checks the same rules directly in SQL.)
// Runs against the LOCAL stack only.
// Run: npx tsx supabase/tests/app/finances.leak.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };

// Through the API, can this client see any of it? (Refused or empty both count as "no".)
async function sees(client: SupabaseClient, what: string) {
  switch (what) {
    case "records": {
      const r = await client.schema("private").from("booking_records").select("id, commission_cents, problem_note");
      return { refused: !!r.error, rows: r.data?.length ?? 0, error: r.error?.message ?? "" };
    }
    case "finances": {
      const r = await client.from("booking_finances").select("booking_id, commission_cents, stripe_charge_id");
      return { refused: !!r.error, rows: r.data?.length ?? 0, error: r.error?.message ?? "" };
    }
    case "reports": {
      const r = await client.from("booking_reports").select("booking_id, note");
      return { refused: !!r.error, rows: r.data?.length ?? 0, error: r.error?.message ?? "" };
    }
    case "old columns": {
      const r = await client.from("bookings").select("id, commission_cents, stripe_payment_intent_id, problem_note");
      return { refused: !!r.error, rows: r.data?.length ?? 0, error: r.error?.message ?? "" };
    }
  }
  throw new Error(what);
}

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const password = randomBytes(18).toString("base64url");
  const signIn = async (label: string) => {
    const { user } = await must(db.auth.admin.createUser({ email: `fin-leak-${label}-${run}@test.local`, password, email_confirm: true }));
    created.users.push(user.id);
    const client = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: user.email!, password }));
    return { id: user.id, client };
  };
  const owner = await signIn("provider");
  const customer = await signIn("customer");
  const anon = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });

  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Leak Test", city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Leak ${run}`, slug: `leak-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Leak ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", kind: "experience",
    category_id: created.category, title: `Leak ${run}`, description: "A listing made by the finances leak test.", price_cents: 5000, duration_minutes: 60,
  }));
  await must(db.from("listing_photos").insert({ listing_id: created.listing, storage_path: `${created.provider}/${created.listing}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
  await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", created.listing));
  const session = (await must(db.from("experience_sessions").insert({ listing_id: created.listing, starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), capacity: 5 }).select("id").single())).id;
  const b = await must(db.rpc("reserve_experience_booking", {
    p_session_id: session, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer", p_customer_email: "sam@test.local",
    p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
  })) as { id: string };
  await must(db.schema("private").from("booking_records").update({ status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: `pi_leak_${run}`, stripe_charge_id: `ch_leak_${run}` }).eq("id", b.id));
  await must(db.from("booking_reports").insert({ booking_id: b.id, note: "Nobody was there at all." }));

  // The server can.
  const server = await sees(db, "records");
  check(!server.refused && server.rows >= 1, "0. (set-up) the server reads private.booking_records");

  // 1. private.booking_records: refused to everyone but the server.
  for (const [who, client] of [["a signed-out visitor", anon], ["a customer", customer.client], ["a provider", owner.client]] as const) {
    const r = await sees(client, "records");
    check(r.refused && /permission denied|schema/i.test(r.error), `1. ${who} can't read private.booking_records through the API (${r.error || `${r.rows} rows`})`);
  }
  // 2. booking_finances: the provider reads their own; the customer and visitors don't.
  const fCustomer = await sees(customer.client, "finances");
  const fAnon = await sees(anon, "finances");
  const fOwner = await sees(owner.client, "finances");
  check(fCustomer.rows === 0, "2a. a customer gets no commission split, payout state or Stripe ids");
  check(fAnon.refused || fAnon.rows === 0, "2b. nor does a signed-out visitor");
  check(!fOwner.refused && fOwner.rows === 1, "2c. the provider reads their own booking's finances");
  // 3. booking_reports: the customer reads their note; the provider doesn't.
  const rOwner = await sees(owner.client, "reports");
  const rCustomer = await sees(customer.client, "reports");
  check(rOwner.rows === 0, "3a. the provider can't read the customer's no-show note");
  check(rCustomer.rows === 1, "3b. the customer reads their own report");
  // 4. The old columns are gone from bookings for everyone.
  for (const [who, client] of [["a customer", customer.client], ["a provider", owner.client]] as const) {
    const r = await sees(client, "old columns");
    check(r.refused && /does not exist|column/i.test(r.error), `4. ${who} can't select the old money columns on bookings (${r.error})`);
  }
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listing) {
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_emails where booking_id in (select id from bookings where listing_id = '${created.listing}');
      delete from booking_finances where booking_id in (select id from bookings where listing_id = '${created.listing}');
      delete from booking_reports where booking_id in (select id from bookings where listing_id = '${created.listing}');
      delete from booking_events where booking_id in (select id from bookings where listing_id = '${created.listing}');
      delete from booking_contacts where booking_id in (select id from bookings where listing_id = '${created.listing}');
      delete from notifications where listing_id = '${created.listing}';
      delete from bookings where listing_id = '${created.listing}';
      delete from experience_sessions where listing_id = '${created.listing}';
      delete from listing_photos where listing_id = '${created.listing}';
      delete from listings where id = '${created.listing}';`]);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All finances leak checks passed.");
process.exit(failures ? 1 : 0);
