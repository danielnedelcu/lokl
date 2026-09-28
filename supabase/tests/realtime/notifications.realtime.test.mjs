// Realtime delivery of notifications (docs/design/notifications.md).
//
// pgTAP covers the table's rules; this covers the Realtime path: a provider
// receives their own new notifications live and never another provider's,
// even when they ask for them by filter.
//
// LOCAL STACK ONLY. It refuses to run against anything but localhost, creates
// its own test users and data with the local service key, and removes them
// afterwards. Needs the full local stack: `npx supabase start`.
// Run with `npm run db:test:realtime`.

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const WAIT_MS = 5000;

// Local URL and keys from the CLI. Never printed.
const env = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes("="))
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
const created = { users: [], providers: [], listings: [], category: null, area: null };
let failures = 0;
const check = (ok, name) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const must = async (p) => {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeProvider(label, cityId) {
  const email = `rt-${label}-${run}@test.local`;
  const password = randomBytes(18).toString("base64url"); // test-only, never printed
  const { user } = await must(server.auth.admin.createUser({ email, password, email_confirm: true }));
  created.users.push(user.id);
  const provider = await must(
    server.from("providers").insert({ owner_id: user.id, display_name: `Realtime ${label}`, city_id: cityId }).select("id").single(),
  );
  created.providers.push(provider.id);
  const client = createClient(url, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { session } = await must(client.auth.signInWithPassword({ email, password }));
  client.realtime.setAuth(session.access_token);
  return { id: provider.id, client };
}

// An Experience in review with a photo, ready to be approved.
async function makeListing(providerId) {
  const id = randomUUID();
  await must(server.from("listings").insert({
    id, provider_id: providerId, kind: "experience", category_id: created.category, city_id: created.city,
    title: `Realtime test ${run}`, description: "A listing made by the Realtime test.", price_cents: 1000,
    duration_minutes: 60, area_id: created.area, status: "submitted",
  }));
  created.listings.push(id);
  await must(server.from("listing_photos").insert({
    listing_id: id, storage_path: `${providerId}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo",
  }));
  return id;
}

const approve = (listingId) =>
  must(server.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", listingId));

// Collects INSERT events on notifications, optionally filtered. Ready once
// Realtime says it's watching the database ("Subscribed to PostgreSQL"):
// a channel is "joined" before that, and on a freshly started stack a change
// made in between is missed. The app's bell waits for the same signal.
function listen(client, name, filter) {
  const events = [];
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const timer = setTimeout(() => rejectReady(new Error(`${name} didn't start watching the database`)), 15000);
  const channel = client
    .channel(`${name}-${run}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", ...(filter ? { filter } : {}) },
      (payload) => events.push(payload.new))
    .on("system", {}, (m) => {
      if (m.extension === "postgres_changes" && m.status === "ok") { clearTimeout(timer); resolveReady(); }
      else if (m.extension === "postgres_changes") { clearTimeout(timer); rejectReady(new Error(`${name}: ${m.message}`)); }
    })
    .subscribe();
  return { events, channel, ready };
}

try {
  const city = await must(server.from("cities").select("id").eq("slug", "atlanta").single());
  created.city = city.id;
  created.category = (await must(server.from("categories").insert({ kind: "experience", name: `Realtime ${run}`, slug: `realtime-${run}` }).select("id").single())).id;
  created.area = (await must(server.from("service_areas").insert({ city_id: city.id, kind: "neighborhood", name: `Realtime ${run}` }).select("id").single())).id;

  const a = await makeProvider("a", city.id);
  const b = await makeProvider("b", city.id);

  const aOwn = listen(a.client, "a-own", `provider_id=eq.${a.id}`);
  const bAll = listen(b.client, "b-unfiltered");                        // no filter: RLS alone decides
  const bSpy = listen(b.client, "b-asks-for-a", `provider_id=eq.${a.id}`); // asks for A's by filter
  await Promise.all([aOwn.ready, bAll.ready, bSpy.ready]);

  // 1. A's listing is approved: only A hears about it.
  const la = await makeListing(a.id);
  await approve(la);
  await sleep(WAIT_MS);
  check(aOwn.events.length === 1 && aOwn.events[0].listing_id === la && aOwn.events[0].kind === "listing_approved",
    "1a. a provider receives their own new notification live");
  check(bAll.events.length === 0, "1b. another provider, subscribed without a filter, receives nothing");
  check(bSpy.events.length === 0, "1c. another provider, asking for the first provider's by filter, receives nothing");

  // 2. B's listing is approved: B hears (so B's subscription works), A doesn't.
  const lb = await makeListing(b.id);
  await approve(lb);
  await sleep(WAIT_MS);
  check(bAll.events.length === 1 && bAll.events[0].listing_id === lb, "2a. the other provider receives their own");
  check(aOwn.events.length === 1, "2b. ...and the first provider receives nothing more");
  check(bSpy.events.length === 0, "2c. ...and the filter for the first provider's still receives nothing");

  await Promise.all([a.client.removeAllChannels(), b.client.removeAllChannels()]);
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${e.message}`);
} finally {
  // Listings first (photos and notifications go with them), then providers, then logins.
  if (created.listings.length) await server.from("listings").delete().in("id", created.listings);
  if (created.providers.length) await server.from("providers").delete().in("id", created.providers);
  for (const id of created.users) await server.auth.admin.deleteUser(id);
  if (created.area) await server.from("service_areas").delete().eq("id", created.area);
  if (created.category) await server.from("categories").delete().eq("id", created.category);
}

console.log(failures ? `${failures} failed` : "All Realtime checks passed.");
process.exit(failures ? 1 : 0);
