// Hidden profile photos really leave the public bucket (admin roles step
// 5e), with the real local Storage and the website's own code
// (apps/website/server/utils/adminProviders.ts): a hidden photo's public
// address stops working and the team sees it by a short-lived link; the
// provider can't reach or delete it; restoring puts it back; confirming
// the removal deletes it; a move left halfway is finished on the next try;
// support can't remove outright; the cached public profile drops hidden
// text at once; and the provider's "hidden" email is skipped once the
// owner has decided.
// Run: npx tsx supabase/tests/app/profile-holds.test.mts (the website on WEBSITE_URL, as the full checks start it)

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { decideProfileHold, HELD_BUCKET, hideProfileContent, PUBLIC_BUCKET, removeProfileContent, settleHeldFiles } from "../../../apps/website/server/utils/adminProviders";
import { sendProviderEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";
import { goLive } from "./_listings";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const WEBSITE_URL = process.env.WEBSITE_URL ?? "http://localhost:3100";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const psql = (sql: string) => execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql]);
const publicUrl = (path: string) => `${local.API_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;
const reachable = async (url: string) => (await fetch(url, { cache: "no-store" })).ok;
const held = async (path: string) => (await db.storage.from(HELD_BUCKET).exists(path)).data === true;
const run = randomBytes(4).toString("hex");
const created = { users: [] as string[], provider: "", listing: "", category: "", area: "" };
const sent: OutgoingEmail[] = [];
const mailer: Mailer = { async send(e) { sent.push(e); return { id: `fake-${sent.length}` }; } };

try {
  const owner = await makeAdmin(local, `holds-owner-${run}@test.local`);
  const support = await makeAdmin(local, `holds-support-${run}@test.local`, { role: "support" });
  created.users.push(owner.id, support.id);
  const password = `pw-${randomBytes(8).toString("hex")}`;
  const { user } = await must(db.auth.admin.createUser({ email: `holds-provider-${run}@test.local`, password, email_confirm: true }));
  created.users.push(user!.id);
  const providerClient = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
  await must(providerClient.auth.signInWithPassword({ email: user!.email!, password }));
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  created.provider = (await must(db.from("providers").insert({ owner_id: user!.id, display_name: `Holds ${run}`, city_id: atl.id }).select("id").single())).id;
  created.category = (await must(db.from("categories").insert({ kind: "experience", name: `Holds ${run}`, slug: `holds-${run}` }).select("id").single())).id;
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Holds ${run}` }).select("id").single())).id;
  created.listing = randomUUID();
  await must(db.from("listings").insert({
    id: created.listing, provider_id: created.provider, kind: "experience", category_id: created.category, city_id: atl.id, area_id: created.area,
    title: `Holds walk ${run}`, description: "A walk made by the hidden profile test.", price_cents: 3000, duration_minutes: 60,
  }));
  await goLive(db, created.listing);
  // A real profile photo (two files) and a headline.
  const photo = async (name: string) => {
    const paths = [`${created.provider}/${name}-${run}.webp`, `${created.provider}/${name}-${run}-small.webp`];
    for (const p of paths) await must(db.storage.from(PUBLIC_BUCKET).upload(p, Buffer.from(`fake webp ${p}`), { contentType: "image/webp", cacheControl: "300" }));
    return paths;
  };
  const avatar = await photo("avatar");
  const slug = (await must(db.from("providers").update({ avatar_path: avatar[0], avatar_small_path: avatar[1], headline: "Walking tours, told well" })
    .eq("id", created.provider).select("slug").single())).slug as string;
  const profile = async () => (await fetch(`${WEBSITE_URL}/api/public/providers/${slug}`)).json() as Promise<{ provider?: { headline: string | null } }>;
  check(await reachable(publicUrl(avatar[0]!)), "0a. the profile photo is at its public address");
  check((await profile()).provider?.headline === "Walking tours, told well", "0b. the public profile (cached) shows the headline");

  // 1. Support hides the photo and the headline.
  const result = await hideProfileContent(support.server, created.provider, support.id, {
    parts: ["avatar", "headline"], rule: "unsuitable_photo", reason: "The photo shows another business's storefront.",
  });
  check(result === "hidden: avatar, headline", `1a. support hides the photo and headline (${result})`);
  check(!(await reachable(publicUrl(avatar[0]!))) && !(await reachable(publicUrl(avatar[1]!))), "1b. the photo's public addresses stop working at once");
  const hold = await must(db.from("provider_profile_holds").select("id, files, held_paths").eq("provider_id", created.provider).eq("part", "avatar").single());
  check(hold.files === "private" && (await held(hold.held_paths![0]!)) && (await held(hold.held_paths![1]!)), "1c. both files are kept in the private bucket");
  // The cache re-reads its content version at most once a second.
  let dropped = false;
  for (let i = 0; i < 50 && !dropped; i++) {
    dropped = (await profile()).provider?.headline === null;
    if (!dropped) await new Promise((r) => setTimeout(r, 100));
  }
  check(dropped, "1d. the cached public profile drops the headline within seconds");
  const signed = await owner.client.storage.from(HELD_BUCKET).createSignedUrl(hold.held_paths![0]!, 60);
  check(!!signed.data?.signedUrl && (await reachable(signed.data.signedUrl)), "1e. the team sees it by a short-lived link");
  const theirs = await providerClient.storage.from(HELD_BUCKET).createSignedUrl(hold.held_paths![0]!, 60);
  check(!theirs.data?.signedUrl, "1f. the provider can't reach it");
  await providerClient.storage.from(HELD_BUCKET).remove([hold.held_paths![0]!]);
  check(await held(hold.held_paths![0]!), "1g. ...or delete it before the owner decides");

  // 2. Support can't remove outright; the owner restores the photo.
  let refused = "";
  try { await removeProfileContent(support.server, created.provider, support.id, { parts: ["bio"], rule: "abuse", reason: "Support removing outright." }); } catch (e) { refused = (e as Error).message; }
  check(refused === "Removing profile content needs the owner. Hide it instead: the owner decides.", "2a. support can't remove profile content outright");
  check(await decideProfileHold(owner.server, hold.id, owner.id, { decision: "restore" }) === "restored", "2b. the owner restores the photo");
  const back = await must(db.from("providers").select("avatar_path").eq("id", created.provider).single());
  check(back.avatar_path === avatar[0] && (await reachable(publicUrl(avatar[0]!))) && !(await held(hold.held_paths![0]!)),
    "2c. it's back at its public address and on the profile");
  // Deleting a provider's photo files is the owner's: support's own client can't.
  await support.client.storage.from(PUBLIC_BUCKET).remove([avatar[0]!]);
  check(await reachable(publicUrl(avatar[0]!)), "2d. support can't delete a provider's photo file directly");

  // 3. The provider's emails: "hidden" is skipped once every part it named is decided.
  const headlineHold = await must(db.from("provider_profile_holds").select("id").eq("provider_id", created.provider).eq("part", "headline").single());
  await decideProfileHold(owner.server, headlineHold.id, owner.id, { decision: "restore" });
  const settings: EmailSettings = { mode: "allowlist", allowlist: [user!.email!], from: "lokl <lokl@innatetheory.com>", replyTo: "replies@example.com", siteUrl: "http://localhost:3100" };
  await sendProviderEmails(db, mailer, settings, { providerId: created.provider });
  const emails = await must(db.from("provider_emails").select("kind, status").eq("provider_id", created.provider));
  const byKind = (k: string) => emails.filter((e) => e.kind === k).map((e) => e.status).join(",");
  check(byKind("provider_profile_hidden") === "skipped", `3a. "hidden" is skipped: both parts were decided before it went (${byKind("provider_profile_hidden")})`);
  check(byKind("provider_profile_restored") === "sent,sent" && sent.some((e) => e.subject === "It's back on your lokl profile"), "3b. ...each restore's email goes");

  // 4. Confirming a removal deletes the hidden files.
  await hideProfileContent(support.server, created.provider, support.id, { parts: ["avatar"], rule: "not_yours", reason: "A photographer's watermark on it." });
  const second = await must(db.from("provider_profile_holds").select("id, held_paths").eq("provider_id", created.provider).eq("part", "avatar").eq("status", "hidden").single());
  check(await decideProfileHold(owner.server, second.id, owner.id, { decision: "remove" }) === "removed", "4a. the owner confirms the removal");
  const gone = await must(db.from("provider_profile_holds").select("files").eq("id", second.id).single());
  check(gone.files === "deleted" && !(await held(second.held_paths![0]!)) && !(await reachable(publicUrl(avatar[0]!))), "4b. the hidden files are deleted everywhere");

  // 5. A move left halfway (one file already moved) is finished on the next try.
  const cover = await photo("cover");
  await must(db.from("providers").update({ cover_path: cover[0], cover_card_path: cover[1] }).eq("id", created.provider));
  await must(support.server.rpc("admin_hide_profile_content", {
    p_admin_id: support.id, p_provider_id: created.provider, p_parts: ["cover"], p_rule: "unsuitable_photo", p_reason: "A stock photo of another city.",
  }));
  const half = await must(db.from("provider_profile_holds").select("id, held_paths").eq("provider_id", created.provider).eq("part", "cover").single());
  await must(db.storage.from(PUBLIC_BUCKET).move(cover[0]!, half.held_paths![0]!, { destinationBucket: HELD_BUCKET }));
  check(await settleHeldFiles(db) === 0, "5a. the next try settles it");
  const settled = await must(db.from("provider_profile_holds").select("files").eq("id", half.id).single());
  check(settled.files === "private" && (await held(half.held_paths![0]!)) && (await held(half.held_paths![1]!)) && !(await reachable(publicUrl(cover[1]!))),
    "5b. ...both files private, nothing left public");

  // 6. Files already gone when it was hidden: recorded, and can't be restored.
  const ghost = [`${created.provider}/ghost-${run}.webp`, `${created.provider}/ghost-${run}-small.webp`];
  psql(`update public.providers set avatar_path = '${ghost[0]}', avatar_small_path = '${ghost[1]}' where id = '${created.provider}'`);
  await hideProfileContent(support.server, created.provider, support.id, { parts: ["avatar"], rule: "abuse", reason: "Files deleted before the move." });
  const ghostHold = await must(db.from("provider_profile_holds").select("id, files").eq("provider_id", created.provider).eq("part", "avatar").eq("status", "hidden").single());
  check(ghostHold.files === "missing", "6a. a photo whose files were already gone is recorded as missing");
  let noRestore = "";
  try { await decideProfileHold(owner.server, ghostHold.id, owner.id, { decision: "restore" }); } catch (e) { noRestore = (e as Error).message; }
  check(noRestore === "The photo's files were gone before lokl could keep them, so it can't be restored.", "6b. ...and can't be restored");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message.split("\n")[0]}`);
} finally {
  forgetTestAdmins();
  if (created.provider) {
    const { data: holds } = await db.from("provider_profile_holds").select("held_paths").eq("provider_id", created.provider);
    const heldFiles = (holds ?? []).flatMap((h) => h.held_paths ?? []);
    if (heldFiles.length) await db.storage.from(HELD_BUCKET).remove(heldFiles);
    const { data: files } = await db.storage.from(PUBLIC_BUCKET).list(created.provider);
    if (files?.length) await db.storage.from(PUBLIC_BUCKET).remove(files.map((f) => `${created.provider}/${f.name}`));
    psql(`set local session_replication_role = replica;
      delete from public.provider_profile_holds where provider_id = '${created.provider}';
      delete from public.provider_emails where provider_id = '${created.provider}';
      delete from public.admin_emails where admin_action_id in (select id from public.admin_actions where target_id = '${created.provider}');
      delete from public.admin_notifications where admin_action_id in (select id from public.admin_actions where target_id = '${created.provider}');
      delete from public.admin_actions where target_id = '${created.provider}';
      delete from public.notifications where listing_id = '${created.listing}';
      delete from public.listing_photos where listing_id = '${created.listing}';
      delete from public.listing_addresses where listing_id = '${created.listing}';
      delete from public.listings where id = '${created.listing}';
      delete from public.providers where id = '${created.provider}';
      delete from public.categories where id = '${created.category}';
      delete from public.service_areas where id = '${created.area}';`);
  }
  for (const id of created.users) await db.auth.admin.deleteUser(id);
}
console.log(failures ? `${failures} failed` : "All hidden profile content checks passed.");
process.exit(failures ? 1 : 0);
