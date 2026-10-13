// "Top rated" on real data, against the LOCAL stack: a listing's published
// reviews averaging 4.8 from 5 make its card and its listing page say "Top
// rated"; removing one review (lokl's removal, under the rules) takes it
// away; 4 reviews of 5 stars don't earn it. Read as visitors read it
// (browsePublicListings, loadPublicListing with the publishable key).
// Run: npx tsx supabase/tests/app/top-rated.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { browsePublicListings, loadPublicListing, publicSupabase } from "../../../apps/website/server/utils/publicListings";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(env.API_URL!, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const visitor = publicSupabase(env.API_URL!, env.PUBLISHABLE_KEY || env.ANON_KEY!);
const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const psql = (sql: string) => execFileSync("psql", [env.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql]);

const created = { users: [] as string[], provider: "", listings: [] as string[], category: "", area: "" };
let sessions = 0;
try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `top-rated-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("owner");
  const customer = await user("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: `Top Rated ${run}`, city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Top rated ${run}`, slug: `top-rated-${run}` }).select("id, slug").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Top rated ${run}` }).select("id").single())).id;

  const listing = async (title: string) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(db.from("listings").insert({
      id, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", kind: "experience",
      category_id: created.category, title, description: "A listing made by the top rated test.", price_cents: 5000, duration_minutes: 60,
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${created.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    const row = await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id).select("slug").single());
    return { id, slug: row.slug as string };
  };
  // A completed booking and its review, as a customer leaves it.
  const review = async (listingId: string, rating: number) => {
    const sessionId = (await must(db.from("experience_sessions").insert({ listing_id: listingId, starts_at: new Date(Date.now() + 3 * 864e5 + sessions++ * 3600_000).toISOString(), capacity: 4 }).select("id").single())).id;
    const b = (await must(db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam", p_customer_email: customer.email,
      p_customer_phone: null, p_customer_notes: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    }))) as { id: string };
    psql(`alter table public.bookings disable trigger bookings_guard;
      update public.bookings set status = 'confirmed', status_changed_by = 'stripe', confirmed_at = now() - interval '4 days',
        starts_at = now() - interval '1 day 1 hour', ends_at = now() - interval '1 day', payout_due_at = now() where id = '${b.id}';
      update public.bookings set status = 'completed', status_changed_by = 'system' where id = '${b.id}';
      alter table public.bookings enable trigger bookings_guard;`);
    return (await must(db.from("reviews").insert({ booking_id: b.id, rating, body: "A review written by the top rated test, long enough." } as never).select("id").single())).id as string;
  };
  const card = async (slug: string) => {
    const page = await browsePublicListings(visitor, { market: "atlanta", kind: "experience", category: `top-rated-${run}`, pageSize: 100 });
    return page?.items.find((i) => i.slug === slug);
  };

  // 1. 4.8 from 5 reviews: top rated, on the card and the listing page.
  const top = await listing(`Top rated walk ${run}`);
  const reviews = [];
  for (const stars of [5, 5, 5, 5, 4]) reviews.push(await review(top.id, stars));
  check((await card(top.slug))?.topRated === true, "1a. 4.8 from 5 reviews: the card is top rated");
  check((await loadPublicListing(visitor, "experience", top.slug))?.topRated === true, "1b. ...and the listing page");

  // 2. A removed review no longer counts: 4 left, so not top rated.
  await must(db.from("reviews").update({ status: "removed", removed_at: new Date().toISOString(), removed_rule: "off_topic", removed_reason: "Test removal." } as never).eq("id", reviews[0]));
  check((await card(top.slug))?.topRated === false, "2a. one review removed (4 left): the card isn't top rated");
  check((await loadPublicListing(visitor, "experience", top.slug))?.topRated === false, "2b. ...nor the listing page");

  // 3. 4 reviews of 5 stars: too few.
  const few = await listing(`Too few reviews walk ${run}`);
  for (let i = 0; i < 4; i++) await review(few.id, 5);
  check((await card(few.slug))?.topRated === false, "3. 5.0 from 4 reviews isn't top rated");

  // 4. 4.6 from 5 reviews: below the line.
  const low = await listing(`Below the line walk ${run}`);
  for (const stars of [5, 5, 5, 5, 3]) await review(low.id, stars);
  check((await card(low.slug))?.topRated === false, "4. 4.6 from 5 reviews isn't top rated");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((id) => `'${id}'`).join(",");
    psql(`set local session_replication_role = replica;
      delete from public.listing_ratings where listing_id in (${ids});
      delete from public.reviews where listing_id in (${ids});
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_contacts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where listing_id in (${ids});
      delete from public.bookings where listing_id in (${ids});
      delete from public.experience_sessions where listing_id in (${ids});
      delete from public.listing_photos where listing_id in (${ids});
      delete from public.listings where id in (${ids});`);
  }
  if (created.provider) {
    psql(`set local session_replication_role = replica; delete from public.provider_ratings where provider_id = '${created.provider}'; delete from public.providers where id = '${created.provider}';`);
  }
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All top rated data checks passed.");
process.exit(failures ? 1 : 0);
