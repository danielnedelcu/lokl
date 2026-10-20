import { execFileSync } from "node:child_process";
import { expect, test } from "../support/fixtures";

// Journey 17: the runtime row-limit check in the built apps, which run with
// NUXT_PUBLIC_ROW_LIMIT_CHECK=throw (scripts/ci-start-apps.mjs). With 1,001
// visible listings, a browser read that asks for no limit fails instead of
// quietly returning 1,000; the sitemap, which reads every listing a page at
// a time on the server, still lists them all.

test("a read cut off at 1,000 rows fails; paged reads don't", { tag: "@serial" }, async ({ page, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const area = await data.area();
  // Test-only, local database: 1,001 live listings, written as drafts with
  // the guards off, with what going live needs (listing_readiness: a photo
  // and the meeting address; the provider's payouts are set up), then taken
  // live with the triggers on.
  const psql = (sql: string) => execFileSync("psql", [data.env.dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" }).trim();
  const ours = `select id from public.listings where slug like 'rowlimit-${data.run}-%'`;
  psql(`begin; set local session_replication_role = replica;
    insert into public.listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
    select 'rowlimit-${data.run}-' || g, '${provider}', 'experience', '${category.id}', '${data.cityId}', 'Row limit walk', 'A listing made by journey 17.', 5000, 60, '${area}'
    from generate_series(1, 1001) g;
    insert into public.listing_photos (listing_id, storage_path, position, alt_text)
    select id, provider_id || '/' || id || '/' || gen_random_uuid() || '.jpg', 0, 'A test photo' from public.listings where id in (${ours});
    insert into public.listing_addresses (listing_id, line1, city, state, postal_code)
    select id, '1 Test Street', 'Atlanta', 'GA', '30312' from public.listings where id in (${ours});
    commit;
    update public.listings set status = 'live', published_at = now() where id in (${ours});`);
  try {
    await page.goto("/atlanta/experiences");
    // The page's own fetch (wrapped by the app), to the local API the app uses.
    const result = await page.evaluate(async ({ url, key }) => {
      try {
        const res = await fetch(`${url}/rest/v1/listings?select=id`, { headers: { apikey: key } });
        return `returned ${(await res.json()).length} rows`;
      } catch (e) {
        return (e as Error).message;
      }
    }, { url: data.env.apiUrl, key: data.env.publishableKey });
    expect(result).toContain("A read of listings returned exactly 1000 rows without asking for a limit");

    const sitemap = await page.request.get("/api/__sitemap__/urls");
    expect(sitemap.ok(), "the sitemap source answers").toBe(true);
    const urls = (await sitemap.json()) as { loc: string }[];
    expect(urls.filter((u) => u.loc.startsWith(`/experiences/rowlimit-${data.run}-`)).length, "...listing all 1,001").toBe(1001);
  } finally {
    psql(`begin; set local session_replication_role = replica;
      delete from public.listing_photos where listing_id in (${ours});
      delete from public.listing_addresses where listing_id in (${ours});
      delete from public.listings where id in (${ours});
      commit;`);
  }
});
