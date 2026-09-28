// Live notifications keep arriving across sign-in token refreshes
// (docs/design/notifications.md, "Tabs left open for hours").
//
// Uses the bell's own channel code (createNotificationFeed) with automatic
// token refresh on, as the website's client runs. After every refresh, and
// after the first token has expired, a listing change must still arrive.
//
// LOCAL STACK ONLY, and only meaningful with a short session: run the local
// stack with `jwt_expiry = 120` in supabase/config.toml (not committed;
// production sessions last an hour). The test refuses to run otherwise.
// Takes about five minutes. Run with:
//   npx tsx supabase/tests/realtime/notifications-token-refresh.realtime.test.mts
// Set NO_REFRESH=1 to check that the test catches an expired session: the
// feed then runs on a client that keeps its first token forever. (Turning off
// autoRefreshToken isn't enough: Realtime asks for the current token on every
// heartbeat, and supabase-js renews an expiring session when asked.)

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createNotificationFeed, type NotificationRow } from "../../../packages/ui/app/utils/notificationFeed";

const MIN_REFRESHES = 2;
const RUN_UNTIL_MS = 2 * 120_000 + 30_000; // past two full session lifetimes
const WAIT_MS = 8000;
const noRefresh = process.env.NO_REFRESH === "1";

const env = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const url = env.API_URL;
if (!url || !env.SERVICE_ROLE_KEY || !env.ANON_KEY) {
  console.error("The full local stack isn't running. Start it with `npx supabase start`.");
  process.exit(1);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("Refusing to run: this test only runs against the local stack.");
  process.exit(1);
}

const server = createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = randomBytes(4).toString("hex");
const created: { user?: string; provider?: string; listing?: string; category?: string; area?: string } = {};
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secondsSince = (t: number) => Math.round((Date.now() - t) / 1000);

try {
  const city = await must(server.from("cities").select("id").eq("slug", "atlanta").single());
  created.category = (await must(server.from("categories").insert({ kind: "experience", name: `Refresh ${run}`, slug: `refresh-${run}` }).select("id").single())).id;
  created.area = (await must(server.from("service_areas").insert({ city_id: city.id, kind: "neighborhood", name: `Refresh ${run}` }).select("id").single())).id;

  const email = `rt-refresh-${run}@test.local`;
  const password = randomBytes(18).toString("base64url"); // test-only, never printed
  const { user } = await must(server.auth.admin.createUser({ email, password, email_confirm: true }));
  created.user = user.id;
  const provider = await must(server.from("providers").insert({ owner_id: user.id, display_name: "Refresh test", city_id: city.id }).select("id").single());
  created.provider = provider.id;

  // A live Experience whose status the test toggles: live -> unpublished -> live.
  const listingId = randomUUID();
  created.listing = listingId;
  await must(server.from("listings").insert({
    id: listingId, provider_id: provider.id, kind: "experience", category_id: created.category, city_id: city.id,
    title: `Refresh test ${run}`, description: "A listing made by the token refresh test.", price_cents: 1000,
    duration_minutes: 60, area_id: created.area, status: "submitted",
  }));
  await must(server.from("listing_photos").insert({ listing_id: listingId, storage_path: `${provider.id}/${listingId}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
  await must(server.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", listingId));
  let live = true;
  const toggle = () => {
    live = !live;
    return must(server.from("listings").update(live
      ? { status: "live", unpublished_reason: null }
      : { status: "unpublished", unpublished_reason: "Taken down by the token refresh test." }).eq("id", listingId));
  };

  // The provider's client, as the website runs it (token refresh on).
  const client = createClient(url, env.ANON_KEY, { auth: { persistSession: false } });
  const { session } = await must(client.auth.signInWithPassword({ email, password }));
  const signedInAt = Date.now();
  const lifetime = (session!.expires_at! * 1000) - signedInAt;
  if (lifetime > 130_000) {
    console.error(`The local session lasts ${Math.round(lifetime / 1000)}s. Set jwt_expiry = 120 in supabase/config.toml and restart the stack.`);
    process.exit(1);
  }
  console.log(`Session lifetime ${Math.round(lifetime / 1000)}s; running for ${RUN_UNTIL_MS / 1000}s${noRefresh ? " with the first token kept forever (the break)" : ""}.`);

  // Counts new tokens, not events: supabase-js can report one refresh twice.
  let refreshes = 0;
  const tokens = new Set([session!.access_token]);
  client.auth.onAuthStateChange((event, s) => {
    if (event === "TOKEN_REFRESHED" && s && !tokens.has(s.access_token)) {
      tokens.add(s.access_token);
      refreshes++;
      console.log(`  token refreshed (${refreshes}) at ${secondsSince(signedInAt)}s`);
    }
  });

  // The break: a client whose token never changes.
  const feedClient = noRefresh
    ? createClient(url, env.ANON_KEY, { accessToken: async () => session!.access_token })
    : client;

  const received: NotificationRow[] = [];
  let readyCount = 0;
  const feed = createNotificationFeed(feedClient, provider.id, {
    onReady: () => { readyCount++; },
    onNotification: (row) => received.push(row),
  });
  for (let i = 0; i < 150 && readyCount === 0; i++) await sleep(100);
  check(readyCount > 0, "0. the feed starts watching the database");

  // After each refresh (and once more at the end, after the first tokens
  // have expired), change the listing and expect the notification.
  let checked = 0;
  let lastCheckedRefresh = -1;
  while (Date.now() - signedInAt < RUN_UNTIL_MS) {
    const due = noRefresh ? secondsSince(signedInAt) > 140 && checked === 0 : refreshes > lastCheckedRefresh && refreshes > 0;
    if (due) {
      lastCheckedRefresh = refreshes;
      const before = received.length;
      await toggle();
      await sleep(WAIT_MS);
      checked++;
      check(received.length === before + 1,
        `${checked}. after ${refreshes} token refresh(es), at ${secondsSince(signedInAt)}s, the notification arrives`);
    }
    await sleep(1000);
  }
  // Final check, well after the original token expired.
  const before = received.length;
  await toggle();
  await sleep(WAIT_MS);
  check(received.length === before + 1, `${++checked}. at ${secondsSince(signedInAt)}s (first token long expired), the notification still arrives`);
  if (!noRefresh) check(refreshes >= MIN_REFRESHES, `the token refreshed at least ${MIN_REFRESHES} times (${refreshes})`);

  feed.stop();
  await feedClient.removeAllChannels();
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

console.log(failures ? `${failures} failed` : "All token refresh checks passed.");
process.exit(failures ? 1 : 0);
