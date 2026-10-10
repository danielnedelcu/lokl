import { execFileSync } from "node:child_process";
import { expect, test } from "../support/fixtures";

// Journey 17: the runtime row-limit check in the built apps, which run with
// NUXT_PUBLIC_ROW_LIMIT_CHECK=throw (scripts/ci-start-apps.mjs). With 1,001
// visible listings, a browser read that asks for no limit fails instead of
// quietly returning 1,000; the sitemap, which reads every listing a page at
// a time on the server, still lists them all.

test("a read cut off at 1,000 rows fails; paged reads don't", async ({ page, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const area = await data.area();
  // Test-only, local database, guards off: 1,001 live listings.
  const psql = (sql: string) => execFileSync("psql", [data.env.dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" }).trim();
  psql(`begin; set local session_replication_role = replica;
    insert into public.listings (slug, provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status, published_at)
    select 'rowlimit-${data.run}-' || g, '${provider}', 'experience', '${category.id}', '${data.cityId}', 'Row limit walk', 'A listing made by journey 17.', 5000, 60, '${area}', 'live', now()
    from generate_series(1, 1001) g;
    commit;`);
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
    psql(`begin; set local session_replication_role = replica; delete from public.listings where slug like 'rowlimit-${data.run}-%'; commit;`);
  }
});
