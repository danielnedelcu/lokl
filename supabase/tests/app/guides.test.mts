// Destination guides, part 2 (docs/design/destination-guides.md, Tests):
// - the body renderer escapes text and keeps only bold, italic and safe
//   links; links to other sites get rel="noopener noreferrer"
// - the body schema allows headings of level 2 and 3 only
// - the editor's publish checklist (guidePublishBlockers) says exactly what
//   publish_guide() says, case by case
// - the publish and unpublish helpers (the admin app's routes) answer
//   plainly, and refuse an id that isn't an admin's
// - the listings block finds what a signed-out visitor sees, and nothing else
// - both apps' routes refuse a request without an admin's sign-in
//
// LOCAL STACK ONLY (`npx supabase start`), plus the dev servers on 3100 and
// 3101 for the route checks. Run with `npm run db:test:app`.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { coverSizeProblem, guideBodySchema, guidePublishBlockers, type Database } from "@repo/types";
import { inlineVNodes, parseInline } from "../../../packages/ui/app/utils/guideInline";
import { runGuideAction } from "../../../apps/admin/server/utils/guides";
import { guideListings } from "../../../apps/website/server/utils/guideListings";
import { publicSupabase } from "../../../apps/website/server/utils/publicListings";

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
const refused = async (f: () => Promise<unknown>) => {
  try {
    await f();
    return null;
  } catch (e) {
    return e as Error & { status?: number };
  }
};
const html = async (source: string) => renderToString(createSSRApp({ render: () => h("p", inlineVNodes(source)) }));

const created = { users: [] as string[], providers: [] as string[], listings: [] as string[], categories: [] as string[], areas: [] as string[], market: "" };

try {
  // -------------------------------------------------------------------------
  // 1. The renderer
  // -------------------------------------------------------------------------
  check((await html("Tom &amp; Jerry <b>bold</b> <i>it</i>")) === "<p>Tom &amp; Jerry <strong>bold</strong> <em>it</em></p>",
    "1a. bold and italic are kept, text is escaped once");
  check((await html('<a href="https://example.com/x">site</a>')) === '<p><a href="https://example.com/x" class="underline underline-offset-4" rel="noopener noreferrer">site</a></p>',
    "1b. a link to another site gets rel=\"noopener noreferrer\"");
  check((await html('<a href="/atlanta/experiences">ours</a>')) === '<p><a href="/atlanta/experiences" class="underline underline-offset-4">ours</a></p>',
    "1c. a link on this site is kept, without rel");
  for (const [label, href] of [
    ["javascript:", "javascript:alert(1)"],
    ["javascript: hidden in entities", "jav&#x61;script:alert(1)"],
    ["javascript: split by a tab", "java\tscript:alert(1)"],
    ["a protocol-relative address", "//evil.example/x"],
    ["plain http", "http://example.com"],
    ["a data: address", "data:text/html,hi"],
  ] as const) {
    check((await html(`<a href="${href}">click</a>`)) === "<p>click</p>", `1d. a link to ${label} is dropped, its text kept`);
  }
  check((await html('<img src=x onerror="alert(1)">safe')) === "<p>safe</p>", "1e. other tags and their attributes are dropped");
  check((await html("<script>alert(1)</script>after")) === "<p>after</p>", "1f. a script's contents never show");
  check((await html("&lt;script&gt;alert(1)&lt;/script&gt;")) === "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    "1g. typed angle brackets show as text, still escaped");
  check((await html("a < b and c > d")) === "<p>a &lt; b and c &gt; d</p>", "1h. a lone < is text");
  check((await html('<b onclick="x">x<i>y</b>z')) === "<p><strong>x<em>y</em></strong>z</p>", "1i. badly nested tags close cleanly");
  check(JSON.stringify(parseInline("a<br>b")) === JSON.stringify([{ type: "text", text: "a" }, { type: "break" }, { type: "text", text: "b" }]),
    "1j. line breaks are kept");

  // -------------------------------------------------------------------------
  // 2. The body schema
  // -------------------------------------------------------------------------
  const body = (block: unknown) => guideBodySchema.safeParse({ blocks: [block] }).success;
  check(body({ type: "header", data: { text: "x", level: 2 } }) && body({ type: "header", data: { text: "x", level: 3 } }),
    "2a. headings of level 2 and 3 are allowed");
  check(!body({ type: "header", data: { text: "x", level: 1 } }), "2b. a level-1 heading is refused (the title is the page's h1)");
  check(!body({ type: "header", data: { text: "x", level: 4 } }), "2c. a level-4 heading is refused");
  check(!body({ type: "list", data: { style: "unordered", items: [{ content: "a", items: [{ content: "b", items: [] }] }] } }),
    "2d. a nested list is refused");
  check(!body({ type: "photo", data: { photoId: "not-an-id" } }), "2e. a photo block needs a photo's id");
  check(!body({ type: "raw", data: { html: "<script>" } }), "2f. an unknown block (raw HTML) is refused");

  // -------------------------------------------------------------------------
  // 3. The checklist says what the database says
  // -------------------------------------------------------------------------
  const market = await must(server.from("cities").insert({ slug: `guides-${run}`, name: `Guideville ${run}`, state: "GA", timezone: "America/New_York" }).select("id, slug").single());
  created.market = market.id;
  const category = await must(server.from("categories").insert({ kind: "experience", name: `Guides ${run}`, slug: `guides-${run}` }).select("id").single());
  const otherCategory = await must(server.from("categories").insert({ kind: "experience", name: `Other ${run}`, slug: `guides-other-${run}` }).select("id").single());
  created.categories.push(category.id, otherCategory.id);
  const area = await must(server.from("service_areas").insert({ city_id: market.id, kind: "neighborhood", name: `Guides ${run}` }).select("id").single());
  created.areas.push(area.id);

  const user = async (label: string, appMeta: Record<string, unknown> = {}) => {
    const { user: u } = await must(server.auth.admin.createUser({ email: `guides-${label}-${run}@test.local`, email_confirm: true, app_metadata: appMeta }));
    created.users.push(u.id);
    return u.id;
  };
  const admin = await user("admin", { role: "admin" });
  const customer = await user("customer");

  const guide = await must(server.from("guides").insert({ market_id: market.id, slug: `g-${run}` }).select("*").single());
  const small = await must(server.from("guide_photos").insert({
    guide_id: guide.id, storage_path: `${guide.id}/${randomUUID()}.webp`, width: 1599, height: 900, alt_text: "Small", source: "own",
  }).select("*").single());
  const big = await must(server.from("guide_photos").insert({
    guide_id: guide.id, storage_path: `${guide.id}/${randomUUID()}.webp`, width: 1600, height: 900, alt_text: "Big", source: "own",
  }).select("*").single());

  // Step by step from an empty draft: at each step, the checklist's first
  // item is the database's refusal, word for word.
  const steps: [string, Record<string, unknown>][] = [
    ["no title", {}],
    ["no teaser", { draft_title: "Murals of the trail" }],
    ["no body", { draft_teaser: "A walk past the murals, and who to book for a guided tour." }],
    ["no area or category", { draft_body: { blocks: [{ type: "paragraph", data: { text: "Hello" } }] } }],
    ["no cover", { draft_category_id: category.id }],
    ["a cover too small", { draft_cover_photo_id: small.id }],
  ];
  for (const [label, update] of steps) {
    if (Object.keys(update).length) await must(server.from("guides").update(update).eq("id", guide.id));
    const g = await must(server.from("guides").select("*").eq("id", guide.id).single());
    const cover = [small, big].find((p) => p.id === g.draft_cover_photo_id) ?? null;
    const mine = guidePublishBlockers(g, cover)[0];
    const theirs = (await refused(() => runGuideAction(server, "publish", guide.id, admin)))?.message;
    check(!!mine && mine === theirs, `3a. ${label}: the checklist and the database say the same thing`);
  }
  await must(server.from("guides").update({ draft_cover_photo_id: big.id }).eq("id", guide.id));
  const ready = await must(server.from("guides").select("*").eq("id", guide.id).single());
  check(guidePublishBlockers(ready, big).length === 0, "3b. a complete draft has nothing on its checklist");
  check(coverSizeProblem({ width: 1600, height: 900 }) === null, "3c. a cover of exactly 1,600 x 900 is accepted");
  check(!!coverSizeProblem({ width: 1599, height: 900 }) && !!coverSizeProblem({ width: 1600, height: 899 }),
    "3d. a cover one pixel under, either way, is refused");
  check(!!coverSizeProblem({ width: 2400, height: 2400 }) && !!coverSizeProblem({ width: 1350, height: 2400 }),
    "3e. a square or portrait cover is refused, however large");

  // -------------------------------------------------------------------------
  // 4. Publishing and unpublishing
  // -------------------------------------------------------------------------
  const asCustomer = await refused(() => runGuideAction(server, "publish", guide.id, customer));
  check(asCustomer?.status === 403, "4a. publishing as someone who isn't an admin is refused (403)");
  const unknown = await refused(() => runGuideAction(server, "publish", randomUUID(), admin));
  check(unknown?.status === 404, "4b. an unknown guide is not found (404)");
  const notAnId = await refused(() => runGuideAction(server, "publish", "../etc", admin));
  check(notAnId?.status === 404, "4c. something that isn't a guide id is not found (404)");
  const tooSmall = await refused(async () => {
    await must(server.from("guides").update({ draft_cover_photo_id: small.id }).eq("id", guide.id));
    await runGuideAction(server, "publish", guide.id, admin);
  });
  check(tooSmall?.status === 409 && /at least 1,600 by 900 pixels \(this one is 1599 by 900\)/.test(tooSmall.message), "4d. a refusal is a 409 with the database's own sentence");
  await must(server.from("guides").update({ draft_cover_photo_id: big.id }).eq("id", guide.id));
  // Photos in the body have no minimum: a tiny one publishes fine.
  const tiny = await must(server.from("guide_photos").insert({
    guide_id: guide.id, storage_path: `${guide.id}/${randomUUID()}.webp`, width: 300, height: 200, alt_text: "Tiny", source: "own",
  }).select("id").single());
  await must(server.from("guides").update({
    draft_body: { blocks: [{ type: "paragraph", data: { text: "Hello" } }, { type: "photo", data: { photoId: tiny.id } }] },
  }).eq("id", guide.id));
  check((await runGuideAction(server, "publish", guide.id, admin)).result === "published", "4e. a complete draft publishes, with a 300 x 200 photo in its body");
  const live = await must(server.from("guides").select("status, title, category_id").eq("id", guide.id).single());
  check(live.status === "published" && live.title === "Murals of the trail" && live.category_id === category.id,
    "4f. the live copy is the draft, listings block included");
  check((await runGuideAction(server, "unpublish", guide.id, admin)).result === "unpublished", "4g. unpublishing works");
  check((await must(server.from("guides").select("status").eq("id", guide.id).single())).status === "unpublished", "4h. it's unpublished");

  // -------------------------------------------------------------------------
  // 5. The listings block: what a visitor sees
  // -------------------------------------------------------------------------
  async function provider(label: string) {
    const owner = await user(`provider-${label}`);
    const p = await must(server.from("providers").insert({ owner_id: owner, display_name: `Guides ${label}`, city_id: market.id }).select("id").single());
    created.providers.push(p.id);
    return p.id;
  }
  const active = await provider("active");
  const suspended = await provider("suspended");
  async function listing(label: string, opts: { provider: string; category: string; live: boolean }) {
    const id = randomUUID();
    created.listings.push(id);
    await must(server.from("listings").insert({
      id, provider_id: opts.provider, kind: "experience", category_id: opts.category, city_id: market.id,
      title: `Guides ${label}`, description: "A listing made by the guides test.", price_cents: 1000,
      duration_minutes: 60, area_id: area.id, status: "submitted",
    }));
    await must(server.from("listing_photos").insert({ listing_id: id, storage_path: `${opts.provider}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    await must(server.from("listing_addresses").insert({ listing_id: id, line1: "1 Test Street", city: "Guideville", state: "GA", postal_code: "30000" }));
    if (opts.live) await must(server.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return id;
  }
  const visible = await listing("visible", { provider: active, category: category.id, live: true });
  await listing("draft", { provider: active, category: category.id, live: false });
  await listing("suspended", { provider: suspended, category: category.id, live: true });
  const otherVisible = await listing("other category", { provider: active, category: otherCategory.id, live: true });
  await must(server.from("providers").update({ status: "suspended" }).eq("id", suspended));

  const byCategory = await guideListings(visitor, { marketId: market.id, categoryId: category.id });
  check(byCategory.total === 1 && byCategory.items[0]?.id === visible, "5a. by category: only the visible listing (no draft, no suspended provider)");
  const byArea = await guideListings(visitor, { marketId: market.id, areaId: area.id });
  check(byArea.total === 2 && new Set(byArea.items.map((i) => i.id)).has(otherVisible), "5b. by area: the visible listings of every category");
  const both = await guideListings(visitor, { marketId: market.id, areaId: area.id, categoryId: otherCategory.id });
  check(both.total === 1 && both.items[0]?.id === otherVisible, "5c. area and category together narrow it");
  const services = await guideListings(visitor, { marketId: market.id, areaId: area.id, kind: "service" });
  check(services.total === 0, "5d. limited to Services: none here");
  check((await guideListings(visitor, { marketId: market.id })).total === 0, "5e. with no area or category, nothing");
  await must(server.from("categories").update({ active: false }).eq("id", otherCategory.id));
  const hidden = await guideListings(visitor, { marketId: market.id, categoryId: otherCategory.id });
  check(hidden.total === 0 && hidden.hidden === "category", "5f. a category hidden from the site matches nothing, and says so");
  check(!JSON.stringify(byArea).toLowerCase().includes("test street"), "5g. no private address in the answer");

  // -------------------------------------------------------------------------
  // 6. The routes refuse a request without an admin's sign-in
  // -------------------------------------------------------------------------
  const status = async (url: string, headers: Record<string, string> = {}) => {
    try {
      return (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" })).status;
    } catch {
      return 0;
    }
  };
  const adminApp = await status(`http://localhost:3101/api/guides/${guide.id}/publish`);
  check(adminApp === 401, `6a. the admin app's publish route refuses a signed-out request (got ${adminApp || "no answer: is the admin app running?"})`);
  const adminUnpublish = await status(`http://localhost:3101/api/guides/${guide.id}/unpublish`);
  check(adminUnpublish === 401, `6b. the admin app's unpublish route refuses a signed-out request (got ${adminUnpublish || "no answer"})`);
  const website = await status("http://localhost:3100/api/admin/guide-listings", { Origin: "http://localhost:3101" });
  check(website === 401, `6c. the website's guide-listings route refuses a request without a token (got ${website || "no answer: is the website running?"})`);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  // Published guides can't be deleted and hold their market, so remove this
  // run's guides with the guard off (local database only).
  if (created.market) {
    execFileSync("psql", [env.DB_URL!, "-q", "-c", `
      alter table public.guides disable trigger guides_guard;
      delete from public.guide_versions where guide_id in (select id from public.guides where market_id = '${created.market}');
      update public.guides set cover_photo_id = null, status = 'draft' where market_id = '${created.market}';
      delete from public.guides where market_id = '${created.market}';
      alter table public.guides enable trigger guides_guard;`]);
  }
  if (created.listings.length) await server.from("listings").delete().in("id", created.listings);
  if (created.providers.length) await server.from("providers").delete().in("id", created.providers);
  for (const id of created.users) await server.auth.admin.deleteUser(id);
  if (created.areas.length) await server.from("service_areas").delete().in("id", created.areas);
  if (created.categories.length) await server.from("categories").delete().in("id", created.categories);
  if (created.market) await server.from("cities").delete().eq("id", created.market);
}
console.log(failures ? `${failures} failed` : "All guide checks passed.");
process.exit(failures ? 1 : 0);
