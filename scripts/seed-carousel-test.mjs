// Test listings for checking the homepage's carousels by eye (2026-10-12):
// 12 Services and 12 Experiences, live, added to an existing test provider,
// each with a copy of one of that provider's listing photos (and the
// Experiences one session each). No logins are created.
//
//   node scripts/seed-carousel-test.mjs --provider <slug>           add them (the hosted test database)
//   node scripts/seed-carousel-test.mjs --remove                    take them all out again
//   ... --local                                                     the local stack instead (its app test)
//
// Everything it adds is tagged: the description is MARKER exactly, and the
// titles start "Test carousel". --remove finds them by the description,
// refuses if any has a booking or a review (they'd be real history), and
// deletes the listings (their photos, sessions and saves go with them) and
// the photo files it copied. Hosted: it reads the website's server key from
// apps/website/.env and never prints it.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export const MARKER = "A test listing added by scripts/seed-carousel-test.mjs, to check the homepage's carousels. Remove with --remove.";
const PER_KIND = 12;
const BUCKET = "listing-photos";

const args = process.argv.slice(2);
const local = args.includes("--local");
const removing = args.includes("--remove");
const providerSlug = args[args.indexOf("--provider") + 1];
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function target() {
  if (local) {
    const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
      .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL ?? "")) fail("Refusing to run: --local needs the local stack (`npx supabase start`).");
    return { url: env.API_URL, key: env.SERVICE_ROLE_KEY, where: "the local stack" };
  }
  let text = "";
  try { text = readFileSync("apps/website/.env", "utf8"); } catch { fail("Refusing to run: apps/website/.env isn't there."); }
  const value = (name) => text.split("\n").find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") ?? "";
  const url = value("NUXT_PUBLIC_SUPABASE_URL");
  const key = value("NUXT_SUPABASE_SECRET_KEY");
  // Shapes only: the values are never printed.
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) fail("Refusing to run: NUXT_PUBLIC_SUPABASE_URL in apps/website/.env is missing or isn't a hosted Supabase address.");
  if (!/^(sb_secret_|eyJ)/.test(key)) fail("Refusing to run: NUXT_SUPABASE_SECRET_KEY in apps/website/.env is missing or isn't a secret key.");
  return { url: url.replace(/\/$/, ""), key, where: "the hosted test database" };
}

const { url, key, where } = target();
const db = createClient(url, key, { auth: { persistSession: false } });
const must = async (p, what) => {
  const { data, error } = await p;
  if (error) fail(`Stopped: couldn't ${what} (${error.message}). Run --remove to take out anything added so far.`);
  return data;
};

async function tagged() {
  // bounded: the test listings, at most a few runs' worth
  return must(db.from("listings").select("id, kind").eq("description", MARKER).range(0, 999), "read the test listings");
}

async function remove() {
  const rows = await tagged();
  if (!rows.length) return console.log(`No test listings on ${where}.`);
  const ids = rows.map((r) => r.id);
  const [{ count: bookings }, { count: reviews }] = await Promise.all([
    db.from("bookings").select("id", { count: "exact", head: true }).in("listing_id", ids),
    db.from("reviews").select("id", { count: "exact", head: true }).in("listing_id", ids),
  ]);
  if (bookings || reviews) fail(`Refusing to remove: ${bookings ?? 0} booking(s) and ${reviews ?? 0} review(s) point at test listings. Nothing was removed.`);
  // bounded: the test listings' photos (one each)
  const photos = await must(db.from("listing_photos").select("storage_path, card_path").in("listing_id", ids).range(0, 1999), "read the test photos");
  const files = photos.flatMap((p) => [p.storage_path, p.card_path].filter(Boolean));
  await must(db.from("listings").delete().in("id", ids), "delete the test listings");
  if (files.length) await must(db.storage.from(BUCKET).remove(files), "delete the copied photo files");
  const left = (await tagged()).length;
  console.log(`Removed ${rows.length} test listings (${rows.filter((r) => r.kind === "service").length} Services, ${rows.filter((r) => r.kind === "experience").length} Experiences) and ${files.length} photo files from ${where}. Test listings left: ${left}.`);
  if (left) process.exit(1);
}

async function add() {
  if (!providerSlug || providerSlug.startsWith("--")) fail("Say which test provider: --provider <slug> (one of yours, with a listing that has a photo).");
  const provider = await must(db.from("providers").select("id, city_id").eq("slug", providerSlug).maybeSingle(), "find the provider");
  if (!provider) fail(`No provider "${providerSlug}" on ${where}.`);
  const source = (await must(db.from("listing_photos").select("storage_path, card_path, alt_text, listing:listings!inner(provider_id)")
    .eq("listing.provider_id", provider.id).limit(1), "find a photo to copy"))[0];
  if (!source) fail("That provider has no listing with a photo to copy. Add one first.");
  const area = (await must(db.from("service_areas").select("id").eq("city_id", provider.city_id).limit(1), "find an area"))[0];
  const category = async (kind) => (await must(db.from("categories").select("id").eq("kind", kind).eq("active", true).limit(1), `find a ${kind} category`))[0];
  const categories = { service: await category("service"), experience: await category("experience") };
  if (!area || !categories.service || !categories.experience) fail("Need an area in the provider's market and an active category of each kind.");

  const ext = source.storage_path.slice(source.storage_path.lastIndexOf("."));
  const cardExt = source.card_path ? source.card_path.slice(source.card_path.indexOf(".card.")) : null;
  let added = 0;
  for (const kind of ["service", "experience"]) {
    for (let n = 1; n <= PER_KIND; n++) {
      const id = randomUUID();
      const label = kind === "service" ? "Service" : "Experience";
      await must(db.from("listings").insert({
        id, provider_id: provider.id, city_id: provider.city_id, area_id: area.id, status: "submitted", kind,
        category_id: categories[kind].id, title: `Test carousel ${label} ${String(n).padStart(2, "0")}`, description: MARKER,
        price_cents: 4000 + n * 250, duration_minutes: 60, location_mode: kind === "service" ? "provider_location" : null,
      }), "add a listing");
      const name = randomUUID();
      const path = `${provider.id}/${id}/${name}${ext}`;
      await must(db.storage.from(BUCKET).copy(source.storage_path, path), "copy the photo");
      const card = cardExt ? `${provider.id}/${id}/${name}${cardExt}` : null;
      if (card) await must(db.storage.from(BUCKET).copy(source.card_path, card), "copy the photo's card copy");
      await must(db.from("listing_photos").insert({ listing_id: id, storage_path: path, card_path: card, position: 0, alt_text: source.alt_text }), "add the photo");
      if (kind === "experience") {
        const starts = new Date(Math.ceil((Date.now() + (6 + n) * 864e5) / 3_600_000) * 3_600_000).toISOString();
        await must(db.from("experience_sessions").insert({ listing_id: id, starts_at: starts, capacity: 8 }), "add a session");
      }
      await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id), "make it live");
      added++;
    }
  }
  console.log(`Added ${added} test listings (${PER_KIND} Services, ${PER_KIND} Experiences) to "${providerSlug}" on ${where}. The homepage shows them within a minute. Take them out with --remove.`);
}

await (removing ? remove() : add());
