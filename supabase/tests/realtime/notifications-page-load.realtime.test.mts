// Live notifications start signed in on a fresh page load
// (docs/design/notifications.md; found in the walkthrough, 2026-09-28).
//
// The website's browser client (@supabase/ssr createBrowserClient) reads its
// session from cookies a moment after it's created, and the bell starts its
// feed straight away. Before the fix, the first Realtime join went out signed
// out, was refused ("invalid column for filter provider_id"), and the rejoin
// didn't always recover, so a notification never arrived. The feed now loads
// the signed-in token before every join.
//
// LOCAL STACK ONLY. Run with:
//   npx tsx supabase/tests/realtime/notifications-page-load.realtime.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { createNotificationFeed } from "../../../packages/ui/app/utils/notificationFeed";

const RUNS = 3;
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
const key = env.PUBLISHABLE_KEY || env.ANON_KEY!;
const server = createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

// The browser's cookie jar, shared across "page loads".
const jar = new Map<string, string>();
const cookies = {
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  setAll: (list: { name: string; value: string }[]) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
};

const created: { user?: string; provider?: string; listing?: string; category?: string; area?: string } = {};
try {
  const city = (await server.from("cities").select("id").eq("slug", "atlanta").single()).data!;
  created.category = (await server.from("categories").insert({ kind: "experience", name: `Page load ${run}`, slug: `page-load-${run}` }).select("id").single()).data!.id;
  created.area = (await server.from("service_areas").insert({ city_id: city.id, kind: "neighborhood", name: `Page load ${run}` }).select("id").single()).data!.id;
  const email = `rt-page-${run}@test.local`;
  const password = randomBytes(18).toString("base64url"); // test-only, never printed
  created.user = (await server.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
  const provider = (await server.from("providers").insert({ owner_id: created.user, display_name: "Page load test", city_id: city.id }).select("id").single()).data!;
  created.provider = provider.id;
  const listing = randomUUID();
  created.listing = listing;
  await server.from("listings").insert({ id: listing, provider_id: provider.id, kind: "experience", category_id: created.category, city_id: city.id,
    title: `Page load ${run}`, description: "A listing for the page load test.", price_cents: 1000, duration_minutes: 60, area_id: created.area, status: "submitted" });
  await server.from("listing_photos").insert({ listing_id: listing, storage_path: `${provider.id}/${listing}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" });
  await server.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", listing);
  let live = true;
  const toggle = () => {
    live = !live;
    return server.from("listings").update(live
      ? { status: "live", unpublished_reason: null }
      : { status: "unpublished", unpublished_reason: "Taken down by the page load test." }).eq("id", listing);
  };

  // Sign in once: this writes the session cookies, as the website's sign-in does.
  await createBrowserClient(url, key, { cookies, isSingleton: false }).auth.signInWithPassword({ email, password });
  await sleep(2000); // let the setup's own approval notification go by

  for (let i = 1; i <= RUNS; i++) {
    // A fresh page load: a new browser client, and the feed started at once.
    const client = createBrowserClient(url, key, { cookies, isSingleton: false });
    const problems: string[] = [];
    const kinds: string[] = [];
    let ready = false;
    const feed = createNotificationFeed(client as never, provider.id, {
      onReady: () => { ready = true; },
      onNotification: (row) => kinds.push(row.kind),
      onProblem: (m) => problems.push(m),
    });
    for (let t = 0; t < 100 && !ready; t++) await sleep(100);
    const expected = live ? "listing_unpublished" : "listing_restored";
    await toggle();
    await sleep(5000);
    check(problems.length === 0, `${i}a. page load ${i}: the first join is accepted (signed in)${problems.length ? `: ${problems[0]!.slice(-60)}` : ""}`);
    check(ready, `${i}b. page load ${i}: live updates start`);
    check(kinds.includes(expected), `${i}c. page load ${i}: the ${expected.replace("listing_", "")} notification arrives live`);
    feed.stop();
    await client.removeAllChannels();
  }
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.listing) await server.from("listings").delete().eq("id", created.listing);
  if (created.provider) await server.from("providers").delete().eq("id", created.provider);
  if (created.user) await server.auth.admin.deleteUser(created.user);
  if (created.area) await server.from("service_areas").delete().eq("id", created.area);
  if (created.category) await server.from("categories").delete().eq("id", created.category);
}
console.log(failures ? `${failures} failed` : "All page load checks passed.");
process.exit(failures ? 1 : 0);
