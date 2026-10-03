// Destination guides as visitors get them (part 4): the website's own
// loaders (apps/website/server/utils/publicGuides.ts) and sitemap, with the
// signed-out client, against the LOCAL stack.
// - only published guides, only their live copy: a newer draft never shows
// - the listings block holds only what a visitor could browse to
// - the homepage list, and the sitemap: published guides only
// Run with `npm run db:test:app`.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { loadHomepageGuides, loadPublicGuide, loadPublicGuides } from "../../../apps/website/server/utils/publicGuides";
import { publicSitemapEntries, publicSupabase } from "../../../apps/website/server/utils/publicListings";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "") || !env.SERVICE_ROLE_KEY) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const server = createClient<Database>(env.API_URL!, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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

const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], areas: [] as string[], guides: [] as string[], market: "" };
try {
  const market = await must(server.from("cities").insert({ slug: `guidetown-${run}`, name: `Guidetown ${run}`, state: "GA", timezone: "America/New_York" }).select("id, slug").single());
  created.market = market.id;
  const category = await must(server.from("categories").insert({ kind: "experience", name: `Walks ${run}`, slug: `walks-${run}` }).select("id, slug").single());
  created.categories.push(category.id);
  const area = await must(server.from("service_areas").insert({ city_id: market.id, kind: "neighborhood", name: `Old Ward ${run}` }).select("id").single());
  created.areas.push(area.id);
  const { user: admin } = await must(server.auth.admin.createUser({ email: `gp-admin-${run}@test.local`, email_confirm: true, app_metadata: { role: "admin" } }));
  created.users.push(admin.id);

  // Two guides: one published (then edited as a draft), one never published.
  const guide = async (slug: string, title: string) => {
    const g = await must(server.from("guides").insert({
      market_id: market.id, slug, draft_title: title, draft_teaser: "A walk through the old ward, and who to book for it.",
      draft_category_id: category.id, draft_area_id: area.id,
      draft_body: { blocks: [{ type: "paragraph", data: { text: "The live words." } }] },
    }).select("id").single());
    created.guides.push(g.id);
    const photo = await must(server.from("guide_photos").insert({
      guide_id: g.id, storage_path: `${g.id}/${randomUUID()}.webp`, width: 2400, height: 1350, alt_text: "The cover", source: "own",
    }).select("id").single());
    await must(server.from("guides").update({ draft_cover_photo_id: photo.id }).eq("id", g.id));
    return g.id;
  };
  const live = await guide(`walk-the-ward-${run}`, "Walk the ward");
  const draft = await guide(`not-yet-${run}`, "Not yet");
  await must(server.rpc("publish_guide", { p_guide_id: live, p_admin_id: admin.id }));
  await must(server.from("guides").update({ draft_title: "SECRET DRAFT", draft_body: { blocks: [{ type: "paragraph", data: { text: "SECRET DRAFT BODY" } }] } }).eq("id", live));
  await must(server.from("homepage_features").delete().gte("position", 1));
  await must(server.from("homepage_features").insert({ position: 1, guide_id: live }));

  // A live listing that matches, and a draft one that mustn't show.
  const owner = await must(server.auth.admin.createUser({ email: `gp-owner-${run}@test.local`, email_confirm: true }));
  created.users.push(owner.user.id);
  const provider = await must(server.from("providers").insert({ owner_id: owner.user.id, display_name: `Ward Walks ${run}`, city_id: market.id }).select("id").single());
  created.providers.push(provider.id);
  const listing = async (title: string, goLive: boolean) => {
    const id = randomUUID();
    created.listings.push(id);
    await must(server.from("listings").insert({
      id, provider_id: provider.id, kind: "experience", category_id: category.id, city_id: market.id, title,
      description: "A walk made for the guides test, long enough.", price_cents: 2500, duration_minutes: 90, area_id: area.id, status: "submitted",
    }));
    await must(server.from("listing_photos").insert({ listing_id: id, storage_path: `${provider.id}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A photo" }));
    await must(server.from("listing_addresses").insert({ listing_id: id, line1: "1 Private Street", city: "Guidetown", state: "GA", postal_code: "30000" }));
    if (goLive) await must(server.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  };
  const liveListing = await listing("Ward walk", true);
  await listing("Draft walk", false);

  // 1. The index
  const index = await loadPublicGuides(visitor, market.slug);
  check(index?.guides.length === 1 && index.guides[0]!.slug === `walk-the-ward-${run}`, "1a. the index lists the published guide only");
  check(index?.guides[0]?.title === "Walk the ward", "1b. ...with its live title, not the newer draft");
  check(!JSON.stringify(index).includes("SECRET"), "1c. no draft text anywhere in the index");

  // 2. One guide
  const one = await loadPublicGuide(visitor, market.slug, `walk-the-ward-${run}`);
  check(one?.guide.title === "Walk the ward" && JSON.stringify(one.guide.body).includes("The live words."), "2a. the guide page gets the live copy");
  check(!JSON.stringify(one).includes("SECRET") && !JSON.stringify(one).includes("draft_"), "2b. ...and no draft text or field");
  check(one?.listings.total === 1 && one.listings.items[0]?.id === liveListing, "2c. the listings block shows the live listing only");
  check(!JSON.stringify(one?.listings).includes("Private Street"), "2d. ...with no private address");
  check((await loadPublicGuide(visitor, market.slug, `not-yet-${run}`)) === null, "2e. a never-published guide isn't found");
  check((await loadPublicGuide(visitor, "atlanta", `walk-the-ward-${run}`)) === null, "2f. nor is a guide asked for in the wrong market");

  // 3. Homepage and sitemap
  const home = await loadHomepageGuides(visitor);
  check(home[0]?.slug === `walk-the-ward-${run}` && !JSON.stringify(home).includes("SECRET"), "3a. the homepage gets the featured guide's live copy");
  const sitemap = (await publicSitemapEntries(visitor)).map((e) => e.loc);
  check(sitemap.includes(`/${market.slug}/guides`) && sitemap.includes(`/${market.slug}/guides/walk-the-ward-${run}`),
    "3b. the sitemap lists the guides index and the published guide");
  check(!sitemap.includes(`/${market.slug}/guides/not-yet-${run}`), "3c. ...but not the draft");

  // 4. Unpublished: gone from everything visitors see.
  await must(server.rpc("unpublish_guide", { p_guide_id: live, p_admin_id: admin.id }));
  check((await loadPublicGuide(visitor, market.slug, `walk-the-ward-${run}`)) === null, "4a. an unpublished guide isn't found");
  check(!(await loadHomepageGuides(visitor)).some((g) => g.slug === `walk-the-ward-${run}`), "4b. ...and is off the homepage");
  check(!(await publicSitemapEntries(visitor)).some((e) => e.loc.includes(`walk-the-ward-${run}`)), "4c. ...and out of the sitemap");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.guides.length) {
    const ids = created.guides.map((id) => `'${id}'`).join(",");
    execFileSync("psql", [env.DB_URL!, "-q", "-c", `
      alter table public.guides disable trigger guides_guard;
      delete from public.homepage_features where guide_id in (${ids});
      delete from public.guide_versions where guide_id in (${ids});
      update public.guides set cover_photo_id = null, status = 'draft' where id in (${ids});
      delete from public.guides where id in (${ids});
      alter table public.guides enable trigger guides_guard;`]);
  }
  if (created.listings.length) await server.from("listings").delete().in("id", created.listings);
  if (created.providers.length) await server.from("providers").delete().in("id", created.providers);
  for (const id of created.users) await server.auth.admin.deleteUser(id);
  if (created.areas.length) await server.from("service_areas").delete().in("id", created.areas);
  if (created.categories.length) await server.from("categories").delete().in("id", created.categories);
  if (created.market) await server.from("cities").delete().eq("id", created.market);
}
console.log(failures ? `${failures} failed` : "All public guide checks passed.");
process.exit(failures ? 1 : 0);
