// Reviews and full carousels on the LOCAL stack only, for checking "Top
// rated" by eye on the built apps (localhost:3200, 2026-10-12). It refuses
// anything but the local stack.
//
//   node scripts/seed-reviews-local.mjs            add them
//   node scripts/seed-reviews-local.mjs --remove   take them all out again
//
// One test provider (its own login, never the admin's) with 12 live Services
// and 12 live Experiences (each Experience with an upcoming session), so both
// homepage carousels show 10 and "See all". Three of the Services have
// published reviews, from completed bookings, and are added last, so they
// open the homepage's Services row (newest first):
//
//   "Seed review Top rated"   5 reviews: 5 5 5 5 4 = 4.80, Top rated
//   "Seed review Just below"  24 reviews: 19 fives, 5 fours = 4.79; shown as
//                             4.8 (rounded), but not Top rated
//   "Seed review Too few"     4 reviews of 5 = 5.0 from 4: too few
//
// Everything it adds is tagged: listings have the description MARKER, the
// provider's name and the categories start "Seed review", the logins are
// seed-reviews-…@test.local. --remove deletes exactly those (bookings and
// reviews included, which only a local test database may do).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MARKER = "A test listing added by scripts/seed-reviews-local.mjs (local stack only). Remove with --remove.";
const EMAIL = (label) => `seed-reviews-${label}@test.local`;
const BUCKET = "listing-photos";
const DAY = 864e5;

const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "") || !/@(127\.0\.0\.1|localhost):/.test(env.DB_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`). This script never touches the hosted database.");
  process.exit(1);
}
const db = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const psql = (sql) => execFileSync("psql", [env.DB_URL, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql], { stdio: ["ignore", "ignore", "inherit"] });
const must = async (p, what) => {
  const { data, error } = await p;
  if (error) {
    console.error(`Stopped: couldn't ${what} (${error.message}). Run --remove to take out anything added so far.`);
    process.exit(1);
  }
  return data;
};

async function remove() {
  // bounded: this script's listings, a few dozen
  const listings = await must(db.from("listings").select("id").eq("description", MARKER).range(0, 999), "read the test listings");
  const ids = listings.map((l) => `'${l.id}'`).join(",");
  const files = [];
  if (listings.length) {
    // bounded: one photo per test listing
    const photos = await must(db.from("listing_photos").select("storage_path").in("listing_id", listings.map((l) => l.id)).range(0, 999), "read the photos");
    files.push(...photos.map((p) => p.storage_path));
    psql(`set local session_replication_role = replica;
      delete from public.review_replies where review_id in (select id from public.reviews where listing_id in (${ids}));
      delete from public.reviews where listing_id in (${ids});
      delete from public.listing_ratings where listing_id in (${ids});
      delete from public.provider_ratings where provider_id in (select provider_id from public.listings where id in (${ids}));
      delete from public.booking_emails where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_finances where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_reports where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_events where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_contacts where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.booking_addresses where booking_id in (select id from public.bookings where listing_id in (${ids}));
      delete from public.notifications where listing_id in (${ids});
      delete from public.saved_listings where listing_id in (${ids});
      delete from public.bookings where listing_id in (${ids});
      delete from public.experience_sessions where listing_id in (${ids});
      delete from public.listing_photos where listing_id in (${ids});
      delete from public.listing_addresses where listing_id in (${ids});
      delete from public.listings where id in (${ids});`);
  }
  if (files.length) await db.storage.from(BUCKET).remove(files);
  psql(`set local session_replication_role = replica;
    delete from public.saved_providers where provider_id in (select id from public.providers where display_name like 'Seed review%');
    delete from public.providers where display_name like 'Seed review%';
    delete from public.categories where name like 'Seed review%';
    delete from public.service_areas where name like 'Seed review%';`);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  let logins = 0;
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith("seed-reviews-") && u.email.endsWith("@test.local")) {
      await db.auth.admin.deleteUser(u.id);
      logins++;
    }
  }
  console.log(`Removed ${listings.length} test listings (with their bookings, reviews and ${files.length} photo files) and ${logins} test logins from the local stack.`);
}

/** A simple 640 x 480 photo in one colour, with a diagonal band (a BMP, made a JPEG by macOS's sips). */
function photo(dir, n, [r, g, b]) {
  const w = 640, h = 480, row = w * 3, size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write("BM"); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const band = Math.abs(x - y * 1.2 - 80) < 90 ? 0.75 : 1 - y / h * 0.25;
      const o = 54 + y * row + x * 3;
      buf[o] = b * band; buf[o + 1] = g * band; buf[o + 2] = r * band;
    }
  }
  const bmp = join(dir, `p${n}.bmp`), jpg = join(dir, `p${n}.jpg`);
  writeFileSync(bmp, buf);
  execFileSync("sips", ["-s", "format", "jpeg", bmp, "--out", jpg], { stdio: "ignore" });
  return readFileSync(jpg);
}

async function add() {
  // bounded: this script's listings
  const already = await must(db.from("listings").select("id").eq("description", MARKER).range(0, 0), "check for an earlier run");
  if (already.length) {
    console.error("The local stack already has this script's test data. Run --remove first, then add again.");
    process.exit(1);
  }
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single(), "find Atlanta");
  const run = randomBytes(3).toString("hex");
  const login = async (label) => (await must(db.auth.admin.createUser({ email: EMAIL(label), email_confirm: true }), "add a login")).user;

  const owner = await login("provider");
  const provider = await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Seed review Studio", city_id: atl.id }).select("id").single(), "add the provider");
  await must(db.from("providers").update({ stripe_account_id: `acct_seed_${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", provider.id), "mark payouts set up");
  // Open all day, every day: Services are booked from their free times.
  await must(db.from("provider_weekly_hours").insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ provider_id: provider.id, weekday, starts: "00:00", ends: "24:00" }))), "add hours");
  const category = async (kind, name) => (await must(db.from("categories").insert({ kind, name: `Seed review ${name}`, slug: `seed-review-${kind}-${run}` }).select("id").single(), "add a category")).id;
  const categories = { service: await category("service", "Haircuts"), experience: await category("experience", "Walks") };
  const area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: "Seed review Old Fourth Ward" }).select("id").single(), "add an area")).id;

  const dir = mkdtempSync(join(tmpdir(), "seed-reviews-"));
  const colours = [[201, 63, 20], [47, 110, 140], [86, 130, 70], [150, 90, 150], [200, 150, 40], [70, 70, 90]];
  const photos = colours.map((c, i) => photo(dir, i, c));

  let n = 0;
  const listing = async (kind, title) => {
    const id = randomUUID();
    await must(db.from("listings").insert({
      id, provider_id: provider.id, city_id: atl.id, area_id: area, kind, category_id: categories[kind], title,
      description: MARKER, price_cents: 4000 + (n % 8) * 500, duration_minutes: 60, location_mode: kind === "service" ? "provider_location" : null,
      booking_mode: kind === "service" ? "approve" : null,
    }), "add a listing");
    const path = `${provider.id}/${id}/${randomUUID()}.jpg`;
    await must(db.storage.from(BUCKET).upload(path, photos[n++ % photos.length], { contentType: "image/jpeg" }), "upload a photo");
    await must(db.from("listing_photos").insert({ listing_id: id, storage_path: path, position: 0, alt_text: `A photo for ${title}` }), "add the photo");
    // Both kinds here meet at an address (listing_readiness): a made-up one.
    await must(db.from("listing_addresses").insert({ listing_id: id, line1: "1 Test Street", city: "Atlanta", state: "GA", postal_code: "30312" }), "add the address");
    if (kind === "experience") {
      const starts = new Date(Math.ceil((Date.now() + (5 + n) * DAY) / 3_600_000) * 3_600_000).toISOString();
      await must(db.from("experience_sessions").insert({ listing_id: id, starts_at: starts, capacity: 8 }), "add a session");
    }
    // Sent for review, then approved (as before).
    await must(db.from("listings").update({ status: "submitted" }).eq("id", id), "send it for review");
    await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id), "make it live");
    return id;
  };

  // Completed Service bookings, each with a published review. One customer
  // login per review, as real reviews would be; first names vary.
  const names = ["Avery", "Jordan", "Priya", "Marcus", "Lena", "Theo", "Imani", "Sofia", "Diego", "Hana", "Malik", "Rosa"];
  let customers = 0;
  const reviewed = async (listingId, stars) => {
    for (const [i, rating] of stars.entries()) {
      const customer = await login(`customer-${++customers}`);
      // A free time three days or more out; the booking is then moved into the past.
      const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
      const slots = await must(db.rpc("service_slots", { p_listing_id: listingId, p_from: day(new Date(Date.now() + 3 * DAY)), p_to: day(new Date(Date.now() + 9 * DAY)) }), "find a free time");
      const b = await must(db.rpc("create_service_booking", {
        p_listing_id: listingId, p_customer_id: customer.id, p_starts_at: slots[0].starts_at,
        p_customer_name: names[i % names.length], p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
        p_address: null, p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
      }), "add a booking");
      const ended = `now() - interval '${2 + i} days'`;
      psql(`alter table public.bookings disable trigger bookings_guard;
        update public.bookings set status = 'confirmed', status_changed_by = 'stripe', confirmed_at = ${ended} - interval '3 days',
          starts_at = ${ended} - interval '1 hour', ends_at = ${ended}, payout_due_at = ${ended} + interval '1 day' where id = '${b.id}';
        update public.bookings set status = 'completed', status_changed_by = 'system' where id = '${b.id}';
        alter table public.bookings enable trigger bookings_guard;`);
      const body = rating === 5
        ? "Friendly, on time and really careful. I'd book again without a second thought."
        : "Good work and easy to book. The start ran a few minutes late, but the result was great.";
      await must(db.from("reviews").insert({ booking_id: b.id, rating, body }).select("id").single(), "add a review");
    }
  };

  // The reviewed Services last: the homepage's Services row shows the newest
  // first, so they open it (Top rated, then Just below, then Too few).
  for (let i = 4; i <= 12; i++) await listing("service", `Seed review Service ${String(i).padStart(2, "0")}`);
  for (let i = 1; i <= 12; i++) await listing("experience", `Seed review Experience ${String(i).padStart(2, "0")}`);
  const few = await listing("service", "Seed review Too few");
  await reviewed(few, [5, 5, 5, 5]);
  const below = await listing("service", "Seed review Just below");
  await reviewed(below, [...Array(19).fill(5), ...Array(5).fill(4)]);
  const top = await listing("service", "Seed review Top rated");
  await reviewed(top, [5, 5, 5, 5, 4]);

  const ratings = await must(db.from("listing_ratings").select("listing_id, rating_average, review_count").in("listing_id", [top, below, few]), "read the ratings");
  const show = (id, label) => {
    const r = ratings.find((x) => x.listing_id === id);
    return `${label}: ${r?.rating_average ?? "?"} from ${r?.review_count ?? 0}`;
  };
  console.log(`Added to the local stack: 12 Services and 12 Experiences from "Seed review Studio", and ${customers} reviews.`);
  console.log(`  ${show(top, "Top rated")} | ${show(below, "Just below (4.79, shown rounded)")} | ${show(few, "Too few")}`);
  console.log("Take it all out with: node scripts/seed-reviews-local.mjs --remove");
}

await (process.argv.includes("--remove") ? remove() : add());
