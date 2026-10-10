// The sitemap past the API's 1,000-row limit (publicSitemapEntries in
// server/utils/publicListings.ts), read as a signed-out visitor against the
// LOCAL stack. Recreates the cut-off found on 2026-10-10: the sitemap asked
// for up to 10,000 listings and providers, and the API returned 1,000 of
// each, so the rest were left out without a word.
// Run: npx tsx supabase/tests/app/public-sitemap.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicSitemapEntries } from "../../../apps/website/server/utils/publicListings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const visitor = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
// The SQL goes on standard input: Linux caps one command-line argument at 128 KB.
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const MANY = 1051;
const market = `sitemap-${run}`;
const mark = `@sitemap-${run}.test.local`;

try {
  // A market of its own with 1,051 providers, each with one live listing,
  // written with the guards off (local database only).
  psql(`set local session_replication_role = replica;
    insert into public.cities (slug, name, state, timezone) values ('${market}', 'Sitemap ${run}', 'GA', 'America/New_York');
    insert into public.categories (kind, name, slug) values ('experience', 'Sitemap ${run}', '${market}');
    insert into public.service_areas (city_id, kind, name) select id, 'neighborhood', 'Sitemap ${run}' from public.cities where slug = '${market}';
    insert into auth.users (id, email) select gen_random_uuid(), 'owner' || g || '${mark}' from generate_series(1, ${MANY}) g;
    insert into public.providers (owner_id, display_name, slug, city_id)
      select u.id, 'Sitemap Provider ' || u.email, 'sitemap-${run}-' || split_part(u.email, '@', 1), c.id
      from auth.users u, public.cities c where u.email like '%${mark}' and c.slug = '${market}';
    insert into public.listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, published_at)
      select 'sitemap-${run}-' || p.slug, p.id, 'experience', cat.id, c.id, 'Sitemap walk', 'A sitemap test listing, long enough.', 5000, 60, a.id, 'live', now()
      from public.providers p join public.cities c on c.id = p.city_id
      join public.categories cat on cat.slug = '${market}'
      join public.service_areas a on a.city_id = c.id
      where c.slug = '${market}';`);

  const entries = await publicSitemapEntries(visitor);
  const locs = new Set(entries.map((e) => e.loc));
  const listings = entries.filter((e) => e.loc.startsWith(`/experiences/sitemap-${run}-`));
  const providers = entries.filter((e) => e.loc.startsWith(`/providers/sitemap-${run}-`));
  check(listings.length === MANY, `1a. all ${MANY} listings are in the sitemap (got ${listings.length})`);
  check(providers.length === MANY, `1b. all ${MANY} provider profiles are in the sitemap (got ${providers.length})`);
  check(locs.has(`/${market}/experiences/${market}`), "1c. the market's category page is in it");
  check(locs.size === entries.length, "1d. no URL twice");
  check(listings.every((e) => !!e.lastmod), "1e. listings carry when they last changed");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  psql(`set local session_replication_role = replica;
    delete from public.listings where city_id in (select id from public.cities where slug = '${market}');
    delete from public.providers where city_id in (select id from public.cities where slug = '${market}');
    delete from auth.users where email like '%${mark}';
    delete from public.service_areas where city_id in (select id from public.cities where slug = '${market}');
    delete from public.categories where slug = '${market}';
    delete from public.cities where slug = '${market}';`);
}
console.log(failures ? `${failures} failed` : "All sitemap checks passed.");
process.exit(failures ? 1 : 0);
