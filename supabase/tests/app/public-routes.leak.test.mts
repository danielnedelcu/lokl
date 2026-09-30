// The public pages can't show what the database hides
// (docs/design/browse-and-listing-pages.md, Tests).
//
// Runs the public routes' own query code (apps/website/server/utils/
// publicListings.ts) with its signed-out client against the local stack.
// Only a visible listing may come back: never a draft, one in review, one
// sent back or taken down, or one whose provider, category or market is
// inactive. Also checks the answers carry no private field.
//
// LOCAL STACK ONLY (`npx supabase start`). Run with `npm run db:test:app`.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  browsePublicListings,
  loadPublicListing,
  loadPublicMarket,
  publicSupabase,
} from "../../../apps/website/server/utils/publicListings";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const url = env.API_URL;
if (!url || !env.SERVICE_ROLE_KEY) {
  console.error("The full local stack isn't running. Start it with `npx supabase start`.");
  process.exit(1);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("Refusing to run: this test only runs against the local stack.");
  process.exit(1);
}
const server = createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const visitor = publicSupabase(url, env.PUBLISHABLE_KEY || env.ANON_KEY!);
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

const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], areas: [] as string[], market: "" };
try {
  // A market of its own, so the test's listings are the only ones in it.
  const market = await must(server.from("cities").insert({ slug: `leak-${run}`, name: `Leakville ${run}`, state: "GA", timezone: "America/New_York" }).select("id, slug").single());
  created.market = market.id;
  const category = await must(server.from("categories").insert({ kind: "experience", name: `Leak ${run}`, slug: `leak-${run}` }).select("id, slug").single());
  const retired = await must(server.from("categories").insert({ kind: "experience", name: `Retired ${run}`, slug: `retired-${run}` }).select("id").single());
  created.categories.push(category.id, retired.id);
  const area = await must(server.from("service_areas").insert({ city_id: market.id, kind: "neighborhood", name: `Leak ${run}` }).select("id").single());
  created.areas.push(area.id);

  async function provider(label: string) {
    const { user } = await must(server.auth.admin.createUser({ email: `leak-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(user.id);
    const p = await must(server.from("providers").insert({ owner_id: user.id, display_name: `Leak ${label}`, city_id: market.id }).select("id").single());
    created.providers.push(p.id);
    return p.id;
  }
  const active = await provider("active");
  const suspended = await provider("suspended");

  // One listing per case. Each goes live first where the case needs it.
  async function listing(label: string, opts: { provider: string; category?: string; status: string }) {
    const id = randomUUID();
    created.listings.push(id);
    await must(server.from("listings").insert({
      id, provider_id: opts.provider, kind: "experience", category_id: opts.category ?? category.id, city_id: market.id,
      title: `Leak ${label}`, description: "A listing made by the public routes leak check.", price_cents: 1000,
      duration_minutes: 60, area_id: area.id, status: "submitted",
    }));
    await must(server.from("listing_photos").insert({ listing_id: id, storage_path: `${opts.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(server.from("listing_addresses").insert({ listing_id: id, line1: "1 Private Street", city: "Leakville", state: "GA", postal_code: "30000" }));
    const update: Record<string, unknown> =
      opts.status === "live" ? { status: "live", published_at: new Date().toISOString() }
      : opts.status === "rejected" ? { status: "rejected", rejection_reason: "Private reason for the provider." }
      : opts.status === "unpublished" ? { status: "live", published_at: new Date().toISOString() }
      : opts.status === "draft" ? { status: "draft" } : {};
    if (Object.keys(update).length) await must(server.from("listings").update(update).eq("id", id));
    if (opts.status === "unpublished") await must(server.from("listings").update({ status: "unpublished", unpublished_reason: "Private reason for the provider." }).eq("id", id));
    return (await must(server.from("listings").select("slug").eq("id", id).single())).slug as string;
  }
  const slugs = {
    visible: await listing("visible", { provider: active, status: "live" }),
    draft: await listing("draft", { provider: active, status: "draft" }),
    submitted: await listing("in review", { provider: active, status: "submitted" }),
    rejected: await listing("sent back", { provider: active, status: "rejected" }),
    unpublished: await listing("taken down", { provider: active, status: "unpublished" }),
    suspendedProvider: await listing("suspended provider", { provider: suspended, status: "live" }),
    inactiveCategory: await listing("inactive category", { provider: active, category: retired.id, status: "live" }),
  };
  await must(server.from("providers").update({ status: "suspended" }).eq("id", suspended));
  await must(server.from("categories").update({ active: false }).eq("id", retired.id));

  // 1. The listing page: only the visible one.
  const visible = await loadPublicListing(visitor, "experience", slugs.visible);
  check(!!visible && visible.hostedBy === "Leak active", "1a. the visible listing loads, with its host's business name");
  for (const [label, slug] of Object.entries(slugs).filter(([k]) => k !== "visible")) {
    check((await loadPublicListing(visitor, "experience", slug)) === null, `1b. no listing page for: ${label}`);
  }
  check((await loadPublicListing(visitor, "service", slugs.visible)) === null, "1c. the wrong kind in the URL is not found");

  // 2. Nothing private in the answer.
  const text = JSON.stringify(visible).toLowerCase();
  for (const word of ["private street", "30000", "private reason", "owner_id", "stripe", "status", "email"]) {
    check(!text.includes(word), `2. the listing answer doesn't contain "${word}"`);
  }

  // 3. Browse: only the visible one, and the counts agree.
  const browse = await browsePublicListings(visitor, { market: market.slug, kind: "experience" });
  check(browse?.total === 1 && browse.items[0]?.slug === slugs.visible, "3a. browsing the market lists only the visible listing");
  const inRetired = await browsePublicListings(visitor, { market: market.slug, kind: "experience", category: `retired-${run}` });
  check(inRetired === null, "3b. an inactive category's page is not found");
  const info = await loadPublicMarket(visitor, market.slug);
  check(info?.categories.find((c) => c.slug === category.slug)?.count === 1, "3c. the market's category count includes only the visible listing");

  // 4. An inactive market hides everything.
  await must(server.from("cities").update({ active: false }).eq("id", market.id));
  check((await loadPublicListing(visitor, "experience", slugs.visible)) === null, "4a. an inactive market's listing page is not found");
  check((await browsePublicListings(visitor, { market: market.slug, kind: "experience" })) === null, "4b. an inactive market can't be browsed");
  check((await loadPublicMarket(visitor, market.slug)) === null, "4c. an inactive market's page is not found");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listings.length) await server.from("listings").delete().in("id", created.listings);
  if (created.providers.length) await server.from("providers").delete().in("id", created.providers);
  for (const id of created.users) await server.auth.admin.deleteUser(id);
  if (created.areas.length) await server.from("service_areas").delete().in("id", created.areas);
  if (created.categories.length) await server.from("categories").delete().in("id", created.categories);
  if (created.market) await server.from("cities").delete().eq("id", created.market);
}
console.log(failures ? `${failures} failed` : "All leak checks passed.");
process.exit(failures ? 1 : 0);
