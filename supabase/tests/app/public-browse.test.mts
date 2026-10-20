// Browse and the market page's category counts past the API's 1,000-row limit (server/utils/publicListings.ts),
// read as a signed-out visitor against the LOCAL stack. Recreates the
// cut-off found on 2026-10-10: browse read at most 1,000 live listings per
// market and kind, then sorted, counted and paged them in code.
// Run: npx tsx supabase/tests/app/public-browse.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { browsePublicListings, loadPublicMarket, PAGE_SIZE } from "../../../apps/website/server/utils/publicListings";
import { addDays } from "../../../packages/ui/app/utils/zonedTime";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const visitor = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
// The SQL goes on standard input: Linux caps one command-line argument at
// 128 KB, and the bulk inserts here are bigger (CI, 2026-10-10).
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const MANY = 1050;
const market = `browse-${run}`;
const created = { user: "", provider: "", city: "", category: "", areas: [] as string[] };

try {
  // A market of its own, so other data doesn't change the counts.
  created.city = (await must(db.from("cities").insert({ slug: market, name: `Browse ${run}`, state: "GA", timezone: "America/New_York" }).select("id").single())).id;
  const { user } = await must(db.auth.admin.createUser({ email: `browse-${run}@test.local`, email_confirm: true }));
  created.user = user.id;
  created.provider = (await must(db.from("providers").insert({ owner_id: user.id, display_name: "Browse Tours", city_id: created.city }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Browse ${run}`, slug: `browse-${run}` }).select("id").single())).id;
  const area = (await must(db.from("service_areas").insert({ city_id: created.city, kind: "neighborhood", name: `Browse A ${run}` }).select("id").single())).id;
  const other = (await must(db.from("service_areas").insert({ city_id: created.city, kind: "neighborhood", name: `Browse B ${run}` }).select("id").single())).id;
  created.areas.push(area, other);

  // 1,050 live Experiences, written with the guards off (local only), each
  // with a session from 10 days on; then one more, written last, whose
  // session is the soonest, in the other area. Written as drafts with what
  // going live needs (listing_readiness: payouts, a photo, the meeting
  // address), then taken live with the triggers on.
  await must(db.from("providers").update({ stripe_account_id: `acct_test_browse${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const soonest = randomUUID();
  const cols = "id, slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id";
  const listing = (id: string, n: string, areaId: string) =>
    `('${id}', 'browse-${run}-${n}', '${created.provider}', 'experience', '${created.category}', '${created.city}', 'Walk ${n}', 'A browse test listing, long enough.', 5000, 60, '${areaId}')`;
  const ids = Array.from({ length: MANY }, () => randomUUID());
  psql(`set local session_replication_role = replica;
    insert into public.listings (${cols}) values ${ids.map((id, i) => listing(id, String(i), area)).join(",")};
    insert into public.experience_sessions (listing_id, starts_at, capacity)
      select l.id, now() + interval '10 days' + (row_number() over (order by l.id)) * interval '1 minute', 10
      from public.listings l where l.city_id = '${created.city}';
    insert into public.listings (${cols}) values ${listing(soonest, "soonest", other)};
    insert into public.experience_sessions (listing_id, starts_at, capacity) values ('${soonest}', now() + interval '1 day', 10);
    insert into public.listing_photos (listing_id, storage_path, position, alt_text)
      select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A test photo' from public.listings where city_id = '${created.city}';
    insert into public.listing_addresses (listing_id, line1, city, state, postal_code)
      select id, '1 Test Street', 'Atlanta', 'GA', '30312' from public.listings where city_id = '${created.city}';`);
  psql(`update public.listings set status = 'live', published_at = now() where city_id = '${created.city}';`);

  const page1 = await browsePublicListings(visitor, { market, kind: "experience" });
  check(page1?.total === MANY + 1, `1a. browse counts all ${MANY + 1} visible Experiences (got ${page1?.total})`);
  check(page1?.items[0]?.id === soonest, "1b. the one with the soonest session is first, though it was written last");
  check(page1?.items.length === PAGE_SIZE, `1c. a page holds ${PAGE_SIZE}`);
  const lastPage = Math.ceil((MANY + 1) / PAGE_SIZE);
  const last = await browsePublicListings(visitor, { market, kind: "experience", page: lastPage });
  check(last?.items.length === (MANY + 1) - (lastPage - 1) * PAGE_SIZE, `1d. the last page (${lastPage}) holds the rest`);
  const page2 = await browsePublicListings(visitor, { market, kind: "experience", page: 2 });
  const seen = [...(page1?.items ?? []), ...(page2?.items ?? [])];
  check(new Set(seen.map((c) => c.id)).size === PAGE_SIZE * 2, "1e. no listing on two pages");
  const times = seen.map((c) => Date.parse(c.nextSessionAt ?? ""));
  check(times.every((t, i) => i === 0 || t >= times[i - 1]!), "1f. soonest next session first, across pages");

  const inArea = await browsePublicListings(visitor, { market, kind: "experience", area: other });
  check(inArea?.total === 1 && inArea.items[0]?.id === soonest, "2a. an area filter finds the one listing there");
  // The range is the session's own day in Atlanta, read back from the
  // database (whose clock wrote it), and the next: a day worked out from
  // this process's clock is a day late if a run crosses Atlanta midnight
  // between the two (found 2026-10-18).
  const { data: session, error: sessionError } = await db.from("experience_sessions").select("starts_at").eq("listing_id", soonest).single();
  if (sessionError) throw new Error(sessionError.message);
  const sessionDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(session.starts_at));
  const dated = await browsePublicListings(visitor, { market, kind: "experience", from: sessionDay, to: addDays(sessionDay, 1) });
  check(dated?.total === 1 && dated.items[0]?.id === soonest, "2b. a date range finds the one listing with a session then");
  check((await browsePublicListings(visitor, { market, kind: "experience", category: "no-such-category" })) === null, "2c. an unknown category is not found");
  // A fixed "now" (2026-10-18): browse takes it for which sessions are still
  // to come. Two days on, the soonest listing's only session has passed.
  const twoDaysOn = await browsePublicListings(visitor, { market, kind: "experience", area: other, now: Date.parse(session.starts_at) + 864e5 });
  check(twoDaysOn?.items[0]?.id === soonest && twoDaysOn.items[0].nextSessionAt === null && inArea?.items[0]?.nextSessionAt === new Date(session.starts_at).toISOString(),
    "2e. given a fixed now, a card shows only sessions still to come then");
  check(page1?.items.every((c) => !("sessionTimes" in c) && !("areaIds" in c)), "2d. cards carry no internal fields");

  // 3. The market page's count per category.
  const info = await loadPublicMarket(visitor, market);
  const count = info?.categories.find((c) => c.slug === `browse-${run}`)?.count;
  check(count === MANY + 1, `3. the market page counts all ${MANY + 1} in the category (got ${count})`);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.city) {
    psql(`set local session_replication_role = replica;
      delete from public.experience_sessions where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.listing_photos where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.listing_addresses where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.listings where city_id = '${created.city}';`);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  if (created.user) await db.auth.admin.deleteUser(created.user);
  for (const id of created.areas) await db.from("service_areas").delete().eq("id", id);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
  if (created.city) await db.from("cities").delete().eq("id", created.city);
}
console.log(failures ? `${failures} failed` : "All public browse checks passed.");
process.exit(failures ? 1 : 0);
