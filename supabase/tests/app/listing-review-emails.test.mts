// Listing review emails (migration listing_review_emails), sent: a team
// member's review queues the provider's email, and the sender
// (sendProviderEmails) sends it to the provider's own address, naming the
// listing, with the provider-facing reason for a rejection and nothing for
// an approval; a rejected draft the provider has since deleted is skipped.
// Run: npx tsx supabase/tests/app/listing-review-emails.test.mts (local stack).

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { sendProviderEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";
import { goLive, makeReady } from "./_listings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = randomBytes(4).toString("hex");
const created = { users: [] as string[], provider: "", listings: [] as string[], category: "", area: "" };
const sent: OutgoingEmail[] = [];
const mailer: Mailer = { async send(e) { sent.push(e); return { id: `fake-${sent.length}` }; } };

try {
  const support = await makeAdmin(local, `lre-support-${run}@test.local`, { role: "support" });
  created.users.push(support.id);
  const providerEmail = `lre-provider-${run}@test.local`;
  const { user } = await must(db.auth.admin.createUser({ email: providerEmail, email_confirm: true }));
  created.users.push(user!.id);
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  created.provider = (await must(db.from("providers").insert({ owner_id: user!.id, display_name: `LRE ${run}`, city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `LRE ${run}`, slug: `lre-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `LRE ${run}` }).select("id").single())).id;
  const experience = async (title: string) => {
    const id = randomUUID();
    await must(db.from("listings").insert({
      id, provider_id: created.provider, kind: "experience", category_id: created.category, city_id: atl.id, area_id: created.area,
      title, description: "An Experience made by the listing review emails test.", price_cents: 3000, duration_minutes: 60,
    }));
    created.listings.push(id);
    await makeReady(db, id);
    await must(db.from("listings").update({ status: "submitted" }).eq("id", id));
    return id;
  };
  const walk = await experience(`LRE walk ${run}`);
  const crawl = await experience(`LRE crawl ${run}`);
  // Payouts ready, so an approval can take it live.
  await must(db.from("providers").update({ stripe_account_id: `acct_test_lre${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));

  // 1. Support reviews both, through the server on their own session.
  const review = (id: string, to: string, reason?: string) =>
    must(support.server.rpc("admin_set_listing_status", { p_admin_id: support.id, p_listing_id: id, p_from: "submitted", p_to: to, p_reason: reason }));
  await review(walk, "live");
  await review(crawl, "rejected", "The photos are of another tour.");
  const settings: EmailSettings = { mode: "allowlist", allowlist: [providerEmail], from: "lokl <lokl@innatetheory.com>", replyTo: "replies@example.com", siteUrl: "http://localhost:3100" };
  await sendProviderEmails(db, mailer, settings, { providerId: created.provider });
  const approved = sent.find((e) => e.subject === `Your Experience “LRE walk ${run}” is live`);
  const rejected = sent.find((e) => e.subject === `Your Experience “LRE crawl ${run}” needs changes`);
  check(!!approved && approved.to === providerEmail && approved.text.includes(`/dashboard/listings/${walk}`), "1a. the approval goes to the provider's own address, linking to the listing");
  check(!!approved && !approved.text.includes("reason"), "1b. ...with no text from lokl");
  check(!!rejected && rejected.to === providerEmail && rejected.text.includes("lokl's reason:\nThe photos are of another tour."), "1c. the rejection carries the reason the provider sees");
  const statuses = await must(db.from("provider_emails").select("kind, status").eq("provider_id", created.provider).order("created_at"));
  check(statuses.map((e) => `${e.kind}:${e.status}`).join(",") === "provider_listing_approved:sent,provider_listing_rejected:sent", "1d. both recorded as sent");

  // 2. A rejected draft the provider deletes before its email goes: skipped.
  const third = await experience(`LRE tasting ${run}`);
  await review(third, "rejected", "The price doesn't match the description.");
  await must(db.from("listings").delete().eq("id", third));
  created.listings = created.listings.filter((id) => id !== third);
  const before = sent.length;
  await sendProviderEmails(db, mailer, settings, { providerId: created.provider });
  const last = await must(db.from("provider_emails").select("status, skip_reason").eq("provider_id", created.provider).eq("kind", "provider_listing_rejected").order("created_at", { ascending: false }).limit(1).single());
  check(sent.length === before && last.status === "skipped" && last.skip_reason === "The listing was deleted.", `2a. the deleted draft's email is skipped (${last.status}: ${last.skip_reason})`);

  // 3. Going live by goLive (no review) sends nothing: only lokl's decisions email.
  const direct = randomUUID();
  await must(db.from("listings").insert({
    id: direct, provider_id: created.provider, kind: "experience", category_id: created.category, city_id: atl.id, area_id: created.area,
    title: `LRE direct ${run}`, description: "Made live directly by the test helper.", price_cents: 3000, duration_minutes: 60,
  }));
  created.listings.push(direct);
  await goLive(db, direct);
  const count = (await must(db.from("provider_emails").select("id").eq("provider_id", created.provider))).length;
  check(count === 3, `3a. a status change outside review queues no email (${count} in all)`);
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  forgetTestAdmins();
  // The outbox and log are append-only: clean up as the owner, triggers off.
  const ids = (xs: string[]) => xs.map((x) => `'${x}'`).join(",") || "null";
  execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", `set session_replication_role = replica;
    delete from public.provider_emails where provider_id = ${created.provider ? `'${created.provider}'` : "null"};
    delete from public.notifications where listing_id in (${ids(created.listings)});
    delete from public.admin_actions where target = 'listing' and target_id in (${ids(created.listings)});
    delete from public.listing_photos where listing_id in (${ids(created.listings)});
    delete from public.listing_addresses where listing_id in (${ids(created.listings)});
    delete from public.listings where id in (${ids(created.listings)});
    ${created.provider ? `delete from public.providers where id = '${created.provider}';` : ""}
    ${created.category ? `delete from public.categories where id = '${created.category}';` : ""}
    ${created.area ? `delete from public.service_areas where id = '${created.area}';` : ""}`]);
  for (const id of created.users) await db.auth.admin.deleteUser(id).catch(() => {});
}
console.log(failures ? `${failures} failed` : "All listing review email checks passed.");
process.exit(failures ? 1 : 0);
