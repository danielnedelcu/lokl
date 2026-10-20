// scripts/seed-carousel-test.mjs, run against the LOCAL stack (--local):
// it adds 12 live Services and 12 live Experiences to a provider, each with a
// copied photo (and the Experiences a session), all tagged; --remove refuses
// while a test listing has a booking, then takes everything out (listings,
// photos, sessions and the copied files) and nothing else.
// Run: npx tsx supabase/tests/app/seed-carousel.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { slotAfter } from "./_slots";

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(env.API_URL!, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MARKER = "A test listing added by scripts/seed-carousel-test.mjs, to check the homepage's carousels. Remove with --remove.";
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
const script = (...args: string[]) => {
  try {
    return { ok: true, out: execFileSync("node", ["scripts/seed-carousel-test.mjs", "--local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};
const count = async (table: string) => (await db.from(table).select("*", { count: "exact", head: true })).count ?? 0;
const tagged = async () => must(db.from("listings").select("id, kind, status, title").eq("description", MARKER));

const created = { user: "", provider: "", listing: "", category: [] as string[], area: "", file: "", booking: "" };
try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const { user } = await must(db.auth.admin.createUser({ email: `seed-carousel-${run}@test.local`, email_confirm: true }));
  created.user = user.id;
  const provider = await must(db.from("providers").insert({ owner_id: user.id, display_name: `Seed Carousel ${run}`, city_id: atl.id }).select("id, slug").single());
  created.provider = provider.id;
  // Payouts set up: the script takes its listings live (listing_readiness).
  await must(db.from("providers").update({ stripe_account_id: `acct_test_seed${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", provider.id));
  for (const kind of ["service", "experience"]) {
    created.category.push((await must(db.from("categories").insert({ kind, name: `Seed ${kind} ${run}`, slug: `seed-${kind}-${run}` }).select("id").single())).id);
  }
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Seed ${run}` }).select("id").single())).id;
  // The provider's own listing, with a photo file to copy.
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: provider.id, city_id: atl.id, area_id: created.area, status: "draft", kind: "service",
    category_id: created.category[0], title: `Seed source ${run}`, description: "The provider's own listing, to copy a photo from.",
    price_cents: 5000, duration_minutes: 60, location_mode: "provider_location", booking_mode: "approve",
  }));
  created.file = `${provider.id}/${created.listing}/${randomUUID()}.jpg`;
  await must(db.storage.from("listing-photos").upload(created.file, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" })));
  await must(db.from("listing_photos").insert({ listing_id: created.listing, storage_path: created.file, position: 0, alt_text: "The provider's photo" }));

  const before = { listings: await count("listings"), photos: await count("listing_photos"), sessions: await count("experience_sessions") };

  // 1. Adding.
  const added = script("--provider", provider.slug);
  check(added.ok && added.out.includes("Added 24 test listings"), `1a. it adds 24 listings (${added.out.trim().slice(0, 120)})`);
  const rows = await tagged();
  check(rows.length === 24 && rows.filter((r) => r.kind === "service").length === 12 && rows.every((r) => r.status === "live"), "1b. 12 Services and 12 Experiences, all live");
  check(rows.every((r) => r.title.startsWith("Test carousel")), "1c. titles start \"Test carousel\"");
  const ids = rows.map((r) => r.id);
  const photos = await must(db.from("listing_photos").select("storage_path").in("listing_id", ids));
  check(photos.length === 24, "1d. each has a photo");
  const files = await Promise.all(photos.map(async (p) => (await db.storage.from("listing-photos").download(p.storage_path)).error === null));
  check(files.every(Boolean), "1e. each photo's file was copied");
  const sessions = await count("experience_sessions");
  check(sessions === before.sessions + 12, "1f. the Experiences have a session each");

  // 2. Removing refuses while a test listing has a booking.
  const bookable = rows.find((r) => r.kind === "service")!;
  const { user: customer } = await must(db.auth.admin.createUser({ email: `seed-carousel-customer-${run}@test.local`, email_confirm: true }));
  created.booking = (await must(db.rpc("create_service_booking", {
    p_listing_id: bookable.id, p_customer_id: customer.id, p_starts_at: await slotAfter(db, bookable.id, 3 * 864e5), p_customer_name: "Sam", p_customer_email: "sam@test.local",
    p_customer_phone: null, p_customer_notes: null, p_address: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
  })) as { id: string }).id;
  const refused = script("--remove");
  check(!refused.ok && refused.out.includes("Refusing to remove") && (await tagged()).length === 24, "2. with a booking on a test listing, --remove refuses and removes nothing");
  execFileSync("psql", [env.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c",
    `set local session_replication_role = replica; delete from public.booking_events where booking_id = '${created.booking}'; delete from public.booking_contacts where booking_id = '${created.booking}'; delete from public.booking_finances where booking_id = '${created.booking}'; delete from public.bookings where id = '${created.booking}';`]);
  created.booking = "";

  // 3. Removing.
  const removed = script("--remove");
  check(removed.ok && removed.out.includes("Removed 24 test listings") && removed.out.includes("Test listings left: 0"), `3a. --remove takes out all 24 (${removed.out.trim().slice(0, 120)})`);
  check((await tagged()).length === 0, "3b. no test listings left");
  const gone = await Promise.all(photos.map(async (p) => (await db.storage.from("listing-photos").download(p.storage_path)).error !== null));
  check(gone.every(Boolean), "3c. the copied photo files are gone");
  const after = { listings: await count("listings"), photos: await count("listing_photos"), sessions: await count("experience_sessions") };
  check(JSON.stringify(after) === JSON.stringify(before), "3d. nothing else changed (listings, photos and sessions as before)");
  check((await db.storage.from("listing-photos").download(created.file)).error === null, "3e. the provider's own photo file is still there");
  check(script("--remove").out.includes("No test listings"), "3f. running --remove again finds nothing to do");
} catch (e) {
  failures++;
  console.error(`FAIL setup or run: ${(e as Error).message}`);
} finally {
  if (created.booking) {
    execFileSync("psql", [env.DB_URL!, "-q", "-c", `set session_replication_role = replica; delete from public.booking_events where booking_id = '${created.booking}'; delete from public.booking_contacts where booking_id = '${created.booking}'; delete from public.booking_finances where booking_id = '${created.booking}'; delete from public.bookings where id = '${created.booking}';`]);
  }
  script("--remove");
  if (created.file) await db.storage.from("listing-photos").remove([created.file]);
  if (created.listing) await db.from("listings").delete().eq("id", created.listing);
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.category) await db.from("categories").delete().eq("id", id);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) if (u.email?.startsWith("seed-carousel-") && u.email.includes(run)) await db.auth.admin.deleteUser(u.id);
}
console.log(failures ? `${failures} failed` : "All carousel seed checks passed.");
process.exit(failures ? 1 : 0);
