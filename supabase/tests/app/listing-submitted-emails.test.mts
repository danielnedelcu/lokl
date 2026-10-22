// An Experience sent for review (migration listing_submitted_alerts), sent:
// the team's emails (sendAdminEmails) go to each active member, owners and
// support, naming the provider and the listing with a link to review it;
// they're skipped for someone who has left the team, and once the listing
// has been reviewed. Each send is narrowed to this test's team members,
// as other tests leave team emails waiting in the same outbox.
// Run: npx tsx supabase/tests/app/listing-submitted-emails.test.mts (local stack).

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { sendAdminEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";
import { makeReady } from "./_listings";

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
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql]);
const run = randomBytes(4).toString("hex");
const created = { users: [] as string[], provider: "", listings: [] as string[], category: "", area: "" };
const sent: OutgoingEmail[] = [];
const mailer: Mailer = { async send(e) { sent.push(e); return { id: `fake-${sent.length}` }; } };
const ADMIN_URL = "http://localhost:3101";

try {
  const ownerEmail = `lsa-owner-${run}@test.local`;
  const supportEmail = `lsa-support-${run}@test.local`;
  const owner = await makeAdmin(local, ownerEmail);
  const support = await makeAdmin(local, supportEmail, { role: "support" });
  created.users.push(owner.id, support.id);
  const { user } = await must(db.auth.admin.createUser({ email: `lsa-provider-${run}@test.local`, email_confirm: true }));
  created.users.push(user!.id);
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  created.provider = (await must(db.from("providers").insert({ owner_id: user!.id, display_name: `LSA Tours ${run}`, city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `LSA ${run}`, slug: `lsa-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `LSA ${run}` }).select("id").single())).id;
  await must(db.from("providers").update({ stripe_account_id: `acct_test_lsa${run}`, stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("id", created.provider));
  const submitted = async (title: string) => {
    const id = randomUUID();
    await must(db.from("listings").insert({
      id, provider_id: created.provider, kind: "experience", category_id: created.category, city_id: atl.id, area_id: created.area,
      title, description: "An Experience made by the listing submitted emails test.", price_cents: 3000, duration_minutes: 60,
    }));
    created.listings.push(id);
    await makeReady(db, id);
    await must(db.from("listings").update({ status: "submitted" }).eq("id", id));
    return id;
  };
  const settings: EmailSettings = { mode: "allowlist", allowlist: [ownerEmail, supportEmail], from: "lokl <lokl@innatetheory.com>", replyTo: "replies@example.com", siteUrl: "http://localhost:3100" };
  const ours = (id: string) => must(db.from("admin_emails").select("recipient_id, status, skip_reason").eq("listing_id", id).in("recipient_id", [owner.id, support.id]));

  // 1. Sent for review: the owner and support are each emailed.
  const walk = await submitted(`LSA walk ${run}`);
  await sendAdminEmails(db, mailer, settings, { adminUrl: ADMIN_URL, recipients: [owner.id, support.id] });
  const toWalk = sent.filter((e) => e.text.includes(`${ADMIN_URL}/listings/${walk}`));
  check(toWalk.map((e) => e.to).sort().join(",") === [ownerEmail, supportEmail].sort().join(","), "1a. the owner and support are each emailed");
  check(toWalk.every((e) => e.subject === "An Experience is waiting for review" && e.text.includes(`LSA Tours ${run} sent “LSA walk ${run}” for review.`)),
    "1b. ...naming the provider and the listing, with a link to review it");

  // 2. Someone who leaves the team before it goes: skipped for them.
  const crawl = await submitted(`LSA crawl ${run}`);
  psql(`update public.admin_members set status = 'removed', removed_at = now() where user_id = '${support.id}'`);
  await sendAdminEmails(db, mailer, settings, { adminUrl: ADMIN_URL, recipients: [owner.id, support.id] });
  const crawlRows = await ours(crawl);
  check(crawlRows.find((r) => r.recipient_id === owner.id)?.status === "sent", "2a. the owner still gets it");
  const supportRow = crawlRows.find((r) => r.recipient_id === support.id);
  check(supportRow?.status === "skipped" && supportRow.skip_reason === "No longer on the team.", `2b. someone who left the team doesn't (${supportRow?.status}: ${supportRow?.skip_reason})`);

  // 3. Reviewed before the email goes: skipped.
  const tasting = await submitted(`LSA tasting ${run}`);
  await must(owner.server.rpc("admin_set_listing_status", { p_admin_id: owner.id, p_listing_id: tasting, p_from: "submitted", p_to: "live" }));
  await sendAdminEmails(db, mailer, settings, { adminUrl: ADMIN_URL, recipients: [owner.id, support.id] });
  const tastingRow = (await ours(tasting)).find((r) => r.recipient_id === owner.id);
  check(tastingRow?.status === "skipped" && tastingRow.skip_reason === "Already reviewed, or taken back by its provider.",
    `3a. already reviewed: skipped (${tastingRow?.status}: ${tastingRow?.skip_reason})`);
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  forgetTestAdmins();
  const ids = (xs: string[]) => xs.map((x) => `'${x}'`).join(",") || "null";
  psql(`set session_replication_role = replica;
    delete from public.admin_emails where listing_id in (${ids(created.listings)});
    delete from public.admin_notifications where listing_id in (${ids(created.listings)});
    delete from public.provider_emails where provider_id = ${created.provider ? `'${created.provider}'` : "null"};
    delete from public.notifications where listing_id in (${ids(created.listings)});
    delete from public.admin_actions where target = 'listing' and target_id in (${ids(created.listings)});
    delete from public.listing_photos where listing_id in (${ids(created.listings)});
    delete from public.listing_addresses where listing_id in (${ids(created.listings)});
    delete from public.listings where id in (${ids(created.listings)});
    ${created.provider ? `delete from public.providers where id = '${created.provider}';` : ""}
    ${created.category ? `delete from public.categories where id = '${created.category}';` : ""}
    ${created.area ? `delete from public.service_areas where id = '${created.area}';` : ""}`);
  for (const id of created.users) await db.auth.admin.deleteUser(id).catch(() => {});
}
console.log(failures ? `${failures} failed` : "All listing submitted email checks passed.");
process.exit(failures ? 1 : 0);
