// The public routes' cache (apps/website/server/utils/publicCache.ts;
// migration public_content_versions), through the website itself on the
// LOCAL stack: a change someone makes on purpose shows at once; a change
// the content versions don't follow (spots, sessions: the 60-second limit,
// imitated here by writing with the triggers off) is still answered from the
// cache; errors aren't kept; and nothing is cacheable at the edge. "At
// once" means within about a second: each copy of the website reads the
// versions at most once a second.
// Needs the apps (scripts/ci-start-apps.mjs). Run with `npm run db:test:app`.

import { execFileSync } from "node:child_process";
import { goLive } from "./_listings";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// The apps' addresses: CI's (3100) unless set, to run these beside dev
// servers (scripts/ci-start-apps.mjs with WEBSITE_PORT and ADMIN_PORT).
const WEBSITE_URL = process.env.WEBSITE_URL ?? "http://localhost:3100";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const get = async (path: string) => {
  const res = await fetch(`${WEBSITE_URL}${path}`);
  return { status: res.status, cacheControl: res.headers.get("cache-control"), text: await res.text() };
};

/** True once `ok` holds: changes show within about a second (the versions are read at most once a second). */
async function soon(ok: () => Promise<boolean>) {
  for (let i = 0; i < 15; i++) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const market = `cache-${run}`;
const created = { user: "", provider: "", city: "", category: "", area: "", listing: randomUUID() };

try {
  created.city = (await must(db.from("cities").insert({ slug: market, name: `Cache ${run}`, state: "GA", timezone: "America/New_York" }).select("id").single())).id;
  const { user } = await must(db.auth.admin.createUser({ email: `cache-${run}@test.local`, email_confirm: true }));
  created.user = user.id;
  const provider = await must(db.from("providers").insert({ owner_id: user.id, display_name: `Cache Tours ${run}`, city_id: created.city }).select("id, slug").single());
  created.provider = provider.id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Cache walks ${run}`, slug: `cache-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: created.city, kind: "neighborhood", name: `Cache Hill ${run}` }).select("id").single())).id;
  await must(db.from("listings").insert({
    id: created.listing, slug: `cache-${run}`, provider_id: created.provider, kind: "experience", category_id: created.category, city_id: created.city,
    title: `First title ${run}`, description: "A listing made by the public cache test.", price_cents: 4000, duration_minutes: 60,
    area_id: created.area,
  }));
  await must(db.from("listing_photos").insert({ listing_id: created.listing, storage_path: `${created.provider}/${created.listing}/${randomUUID()}.webp`, position: 0, alt_text: "A cache test photo" }));
  // Live (listing_readiness: the meeting address, and payouts, which stay
  // set up: part 1 takes the listing down and puts it back live).
  await must(db.from("providers").update({ stripe_account_id: `acct_test_cache${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  await goLive(db, created.listing, { submit: false });
  await must(db.from("experience_sessions").insert({ listing_id: created.listing, starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), capacity: 10 }));
  const browse = `/api/public/browse?market=${market}&kind=experience`;

  // 1. Cached, and changes show at once.
  const first = await get(browse);
  check(first.status === 200 && first.text.includes(`First title ${run}`), "1a. browse shows the listing");
  check(first.cacheControl === "private, no-cache", `1b. ...and isn't cacheable at the edge (got "${first.cacheControl}")`);
  // A change the content versions don't follow (the triggers off, as for
  // spots and sessions): the cached answer is still served.
  psql(`set local session_replication_role = replica; update public.listings set title = 'Unseen title ${run}' where id = '${created.listing}';`);
  await new Promise((r) => setTimeout(r, 1_100)); // past the versions' one second
  check((await get(browse)).text.includes(`First title ${run}`), "1c. a change outside the content versions is still answered from the cache (the 60-second limit)");
  await must(db.from("listings").update({ title: `Second title ${run}` }).eq("id", created.listing));
  check(await soon(async () => (await get(browse)).text.includes(`Second title ${run}`)), "1d. a listing edited shows at once");
  await must(db.from("listings").update({ status: "unpublished", unpublished_reason: "Taken down by the public cache test." }).eq("id", created.listing));
  check(await soon(async () => !(await get(browse)).text.includes(`Second title ${run}`)), "1e. a listing taken down disappears at once");
  await must(db.from("listings").update({ status: "live", unpublished_reason: null }).eq("id", created.listing));
  check(await soon(async () => (await get(browse)).text.includes(`Second title ${run}`)), "1f. ...and comes back at once");

  // 2. A new session follows the 60-second limit: the cached answer stays.
  const before = (await get(browse)).text;
  await new Promise((r) => setTimeout(r, 1_100)); // past the versions' one second
  await must(db.from("experience_sessions").insert({ listing_id: created.listing, starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), capacity: 10 }));
  check((await get(browse)).text === before, "2a. a new session doesn't clear the cache (spots and dates follow the 60 seconds)");

  // 3. A provider suspended: their page is not found at once, and the 404
  // isn't kept once they're reinstated.
  const profile = `/api/public/providers/${provider.slug}`;
  check((await get(profile)).status === 200, "3a. the provider's page is found");
  await must(db.from("providers").update({ status: "suspended" }).eq("id", created.provider));
  check(await soon(async () => (await get(profile)).status === 404), "3b. suspended: not found at once");
  check(await soon(async () => !(await get(browse)).text.includes(`Second title ${run}`)), "3c. ...and their listing leaves browse at once");
  await must(db.from("providers").update({ status: "active" }).eq("id", created.provider));
  check(await soon(async () => (await get(profile)).status === 200), "3d. reinstated: found at once (the 404 wasn't kept)");

  // 4. A category switched off leaves the market at once.
  const marketPage = `/api/public/markets/${market}`;
  check((await get(marketPage)).text.includes(`Cache walks ${run}`), "4a. the market lists the category");
  await must(db.from("categories").update({ active: false }).eq("id", created.category));
  check(await soon(async () => !(await get(marketPage)).text.includes(`Cache walks ${run}`)), "4b. switched off: gone at once");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  psql(`set local session_replication_role = replica;
    delete from public.experience_sessions where listing_id = '${created.listing}';
    delete from public.listing_photos where listing_id = '${created.listing}';
    delete from public.listing_addresses where listing_id = '${created.listing}';
    delete from public.listings where id = '${created.listing}';
    delete from public.providers where id = '${created.provider || randomUUID()}';
    delete from public.service_areas where id = '${created.area || randomUUID()}';
    delete from public.categories where id = '${created.category || randomUUID()}';
    delete from public.cities where id = '${created.city || randomUUID()}';`);
  if (created.user) await db.auth.admin.deleteUser(created.user);
}
console.log(failures ? `${failures} failed` : "All public cache checks passed.");
process.exit(failures ? 1 : 0);
