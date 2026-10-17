// Search by availability (docs/design/service-availability.md, "Search";
// migration service_open_days), through browse's own code as a signed-out
// visitor against the LOCAL stack:
// - every Service matches a date range exactly when the panel's own
//   service_slots has a time in it, for single days, this weekend and 31
//   days, ordered by the first free time and opening on its first free day;
// - the same answers when the table covers nothing (the live part, as before
//   the daily job runs), and "Not taking bookings yet" for those with none;
// - two bookings for one provider at once both go through, without a long
//   wait or a deadlock from refreshing the provider's open days.
// Run with the device in another zone too: TZ=Asia/Tokyo npx tsx supabase/tests/app/search-availability.test.mts

import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { browsePublicListings } from "../../../apps/website/server/utils/publicListings";
import { addDays, instantToZoned, quickDates, todayIn } from "../../../packages/ui/app/utils/zonedTime";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const visitor = createClient(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: sql });

const run = randomBytes(4).toString("hex");
const TZ = "America/New_York";
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const market = `avail-${run}`;
const created = { users: [] as string[], providers: [] as string[], city: "", category: "", area: "" };

try {
  created.city = (await must(db.from("cities").insert({ slug: market, name: `Avail ${run}`, state: "GA", timezone: TZ }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "service", name: `Avail ${run}`, slug: `avail-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: created.city, kind: "neighborhood", name: `Avail ${run}` }).select("id").single())).id;
  const today = todayIn(TZ);
  const login = async (label: string) => {
    const { user } = await must(db.auth.admin.createUser({ email: `avail-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(user.id);
    return user;
  };
  const provider = async (label: string) => {
    const owner = await login(label);
    const id = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: `Avail ${label}`, city_id: created.city }).select("id").single())).id as string;
    created.providers.push(id);
    await must(db.from("providers").update({ stripe_account_id: `acct_test_${label}${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", id));
    return id;
  };
  const service = async (providerId: string, title: string, duration: number, mode: "instant" | "approve", buffer?: number) => {
    const id = randomUUID();
    await must(db.from("listings").insert({
      id, provider_id: providerId, city_id: created.city, area_id: created.area, kind: "service", category_id: created.category, title,
      description: "A Service made by the search availability test.", price_cents: 4000, duration_minutes: duration,
      location_mode: "provider_location", booking_mode: mode, buffer_minutes: buffer ?? null, status: "submitted",
    }));
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: `${providerId}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A photo" }));
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id));
    return { id, title };
  };
  const weekly = (providerId: string, days: number[], starts: string, ends: string) =>
    must(db.from("provider_weekly_hours").insert(days.map((weekday) => ({ provider_id: providerId, weekday, starts, ends }))));

  // Five providers with different weeks.
  const p1 = await provider("p1"); // weekdays 9-5, an hour's notice
  await must(db.from("provider_schedules").insert({ provider_id: p1, min_notice_minutes: 60 }));
  await weekly(p1, [1, 2, 3, 4, 5], "09:00", "17:00");
  const p2 = await provider("p2"); // only two dates, early
  await must(db.from("provider_date_hours").insert([
    { provider_id: p2, on_date: addDays(today, 3), starts: "07:00", ends: "08:00" },
    { provider_id: p2, on_date: addDays(today, 10), starts: "07:00", ends: "08:00" },
  ]));
  const p3 = await provider("p3"); // no hours
  const p4 = await provider("p4"); // every day, a week off, a buffer
  await weekly(p4, [0, 1, 2, 3, 4, 5, 6], "08:00", "20:00");
  await must(db.from("provider_time_off").insert({ provider_id: p4, starts_on: addDays(today, 5), ends_on: addDays(today, 7) }));
  const p5 = await provider("p5"); // weekend nights, 10 PM to midnight (the next day in UTC)
  await weekly(p5, [0, 6], "22:00", "24:00");
  const services = [
    await service(p1, "A trim", 60, "instant"), await service(p1, "B colour", 90, "approve"),
    await service(p2, "C shave", 30, "instant"), await service(p3, "D braids", 60, "instant"),
    await service(p4, "E massage", 60, "approve", 30), await service(p5, "F nails", 60, "instant"),
  ];
  // A booking that takes p4's first time three days out.
  const customer = await login("customer");
  const p4First = (await must(visitor.rpc("service_slots", { p_listing_id: services[4]!.id, p_from: addDays(today, 3), p_to: addDays(today, 3) })) as { starts_at: string }[])[0]!.starts_at;
  await must(db.rpc("create_service_booking", {
    p_listing_id: services[4]!.id, p_customer_id: customer.id, p_starts_at: p4First, p_customer_name: "Sam", p_customer_email: "sam@test.local",
    p_customer_phone: null, p_customer_notes: null, p_address: null, p_reserved_until: new Date(Date.now() + 30 * 60_000).toISOString(),
  }));

  // What the panel shows: each Service's first time in a range (31 days at a time).
  const firstSlot = async (listingId: string, from: string, to: string) => {
    for (let d = from; d <= to; d = addDays(d, 31)) {
      const end = addDays(d, 30) < to ? addDays(d, 30) : to;
      const slots = await must(visitor.rpc("service_slots", { p_listing_id: listingId, p_from: d, p_to: end })) as { starts_at: string }[];
      if (slots.length) return slots[0]!.starts_at;
    }
    return null;
  };
  const weekend = quickDates(TZ).weekend;
  const ranges = [
    ...Array.from({ length: 15 }, (_, i) => ({ name: `day ${i}`, from: addDays(today, i), to: addDays(today, i) })),
    { name: "this weekend", ...weekend },
    { name: "31 days", from: addDays(today, 1), to: addDays(today, 31) },
  ];
  const compare = async (label: string) => {
    let all = true;
    const wrong: string[] = [];
    for (const r of ranges) {
      const expected = (await Promise.all(services.map(async (s) => ({ ...s, first: await firstSlot(s.id, r.from, r.to) }))))
        .filter((s) => s.first)
        .sort((a, b) => Date.parse(a.first!) - Date.parse(b.first!) || a.title.localeCompare(b.title));
      const got = await browsePublicListings(visitor, { market, kind: "service", from: r.from, to: r.to, pageSize: 100 });
      const ok = JSON.stringify(got!.items.map((c) => c.id)) === JSON.stringify(expected.map((s) => s.id))
        && got!.items.every((c, i) => c.openOn === instantToZoned(expected[i]!.first!, TZ).date);
      if (!ok) { all = false; wrong.push(r.name); }
    }
    check(all, `${label}: every range matches the panel's times, in order of the first free time, each opening on its first free day${wrong.length ? ` (wrong: ${wrong.join(", ")})` : ""}`);
  };

  // 1. From the table.
  await compare("1a. from the open days");
  const undated = await browsePublicListings(visitor, { market, kind: "service", pageSize: 100 });
  check(undated!.items.at(-1)?.title === "D braids" && undated!.items.filter((c) => c.notTakingBookings).map((c) => c.title).join() === "D braids",
    "1b. undated: the Service with no hours comes last, marked Not taking bookings yet");
  const p5Night = await firstSlot(services[5]!.id, weekend.from, weekend.to);
  // Whichever weekend night comes first (late on a Friday, Saturday's is
  // inside the notice): its Atlanta day isn't its UTC day.
  const nightDay = p5Night ? instantToZoned(p5Night, TZ).date : "";
  check(!!p5Night && nightDay >= weekend.from && nightDay <= weekend.to && new Date(p5Night).getUTCDate() !== Number(nightDay.slice(8)),
    "1c. (the fixture has a night time that's the next day in UTC, matched to its Atlanta day)");

  // 2. As if the daily job had never run: the table covers nothing ahead.
  psql(`delete from public.service_open_days where listing_id in (select id from public.listings where city_id = '${created.city}');
    update public.service_open_days_refreshed set covered_through = '${addDays(today, -1)}'
     where listing_id in (select id from public.listings where city_id = '${created.city}');`);
  await compare("2a. worked out live");
  psql(`delete from public.service_open_days_refreshed where listing_id in (select id from public.listings where city_id = '${created.city}');`);
  await compare("2b. never worked out");
  await must(db.rpc("refresh_service_open_days", { p_provider_ids: created.providers }));
  await compare("2c. refreshed again");

  // 3. Two bookings for one provider at once, for different times.
  const p1Slots = (await must(visitor.rpc("service_slots", { p_listing_id: services[0]!.id, p_from: addDays(today, 1), p_to: addDays(today, 14) })) as { starts_at: string }[])
    .map((s) => s.starts_at);
  const book = (listingId: string, at: string) => db.rpc("create_service_booking", {
    p_listing_id: listingId, p_customer_id: customer.id, p_starts_at: at, p_customer_name: "Sam", p_customer_email: "sam@test.local",
    p_customer_phone: null, p_customer_notes: null, p_address: null, p_reserved_until: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  let pairsOk = true;
  let slowest = 0;
  for (let i = 0; i < 5; i++) {
    const started = Date.now();
    // Two of the provider's Services, times far enough apart not to overlap.
    const [a, b] = await Promise.all([book(services[0]!.id, p1Slots[i * 8]!), book(services[1]!.id, p1Slots[i * 8 + 4]!)]);
    slowest = Math.max(slowest, Date.now() - started);
    if (a.error || b.error) { pairsOk = false; console.error(a.error?.message, b.error?.message); }
  }
  check(pairsOk, "3a. five pairs of simultaneous bookings for one provider all go through");
  check(slowest < 3000, `3b. ...each pair within 3 seconds (slowest ${slowest} ms)`);
  // One transaction that has refreshed the provider and stays open a while:
  // a second booking waits for it, then goes through (no deadlock, no error).
  const holdFor = 1500;
  const held = new Promise<number>((resolve, reject) => {
    const sql = `begin;
      select public.create_service_booking('${services[0]!.id}', '${customer.id}', '${p1Slots[50]}', 'Sam', 'sam@test.local', null, null, null, now() + interval '30 minutes');
      select pg_sleep(${holdFor / 1000});
      commit;`;
    const child = spawn("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: ["ignore", "ignore", "pipe"] });
    child.on("exit", (code) => (code === 0 ? resolve(code) : reject(new Error(`psql exited ${code}`))));
  });
  await new Promise((r) => setTimeout(r, 300));
  const started = Date.now();
  const second = await book(services[1]!.id, p1Slots[54]!);
  const waited = Date.now() - started;
  await held;
  check(!second.error, `3c. a second booking while the first is still open goes through${second.error ? ` (${second.error.message})` : ""}`);
  check(waited < holdFor + 2000, `3d. ...after waiting at most for the first to finish (${waited} ms)`);
  const firsts = await must(db.from("service_open_days").select("on_date, first_at").eq("listing_id", services[0]!.id)) as { on_date: string; first_at: string }[];
  const bookedDays = new Set([p1Slots[50]!, p1Slots[54]!].map((t) => instantToZoned(t, TZ).date));
  const expectedFirsts = await Promise.all([...bookedDays].map(async (d) => [d, await firstSlot(services[0]!.id, d, d)] as const));
  check(expectedFirsts.every(([d, first]) => firsts.find((f) => f.on_date === d)?.first_at && Date.parse(firsts.find((f) => f.on_date === d)!.first_at) === Date.parse(first!)),
    "3e. ...and the open days then show both bookings' times taken");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.city) {
    psql(`set local session_replication_role = replica;
      delete from public.booking_emails where booking_id in (select b.id from public.bookings b join public.listings l on l.id = b.listing_id where l.city_id = '${created.city}');
      delete from public.booking_events where booking_id in (select b.id from public.bookings b join public.listings l on l.id = b.listing_id where l.city_id = '${created.city}');
      delete from public.notifications where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.booking_contacts where booking_id in (select b.id from public.bookings b join public.listings l on l.id = b.listing_id where l.city_id = '${created.city}');
      delete from public.booking_finances where booking_id in (select b.id from public.bookings b join public.listings l on l.id = b.listing_id where l.city_id = '${created.city}');
      delete from public.provider_holds where provider_id in (select id from public.providers where city_id = '${created.city}');
      delete from public.bookings where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.service_open_days where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.service_open_days_refreshed where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.listing_photos where listing_id in (select id from public.listings where city_id = '${created.city}');
      delete from public.listings where city_id = '${created.city}';`);
  }
  for (const id of created.providers) await db.from("providers").delete().eq("id", id);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  if (created.category) await db.from("categories").delete().eq("id", created.category);
  if (created.city) await db.from("cities").delete().eq("id", created.city);
}
console.log(failures ? `${failures} failed` : "All search availability checks passed.");
process.exit(failures ? 1 : 0);
