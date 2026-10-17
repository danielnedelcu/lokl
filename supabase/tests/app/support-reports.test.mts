// Problem reports, the provider's side (docs/design/problem-reports.md):
// the website routes' own code (server/utils/supportReports.ts) as signed-in
// providers, and the support emails sent with a fake mailer
// (sendSupportEmails), against the LOCAL stack. Each email names the
// report and links to it, and never carries what the provider or lokl
// wrote. No real email is sent.
// Run: npx tsx supabase/tests/app/support-reports.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPPORT_LIMIT_REPORTS, supportRefusalText, type Database } from "@repo/types";
import { sendSupportEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { addProviderMessage, createSupportReport, markSupportReportSorted, SupportError } from "../../../apps/website/server/utils/supportReports";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient<Database>(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
/** The SupportError a call is refused with, or null if it went through. */
async function refusal(p: Promise<unknown>): Promise<SupportError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof SupportError) return e;
    throw e;
  }
}
function fakeMailer() {
  const sent: OutgoingEmail[] = [];
  const m: Mailer & { sent: OutgoingEmail[] } = {
    sent,
    async send(e) {
      sent.push(e);
      return { id: `re_test_${sent.length}` };
    },
  };
  return m;
}
const settings: EmailSettings = { mode: "send", allowlist: [], from: "lokl <test@test.local>", replyTo: "help@test.local", siteUrl: "http://localhost:3100" };
const ADMIN_URL = "http://localhost:3101";

const created = { users: [] as string[], providers: [] as string[] };
// What the provider and lokl write: none of it may reach an email.
const SECRET = `private-words-${run}`;

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  // Test logins on the local stack only, with a throwaway password.
  const password = randomBytes(18).toString("base64url");
  const user = async (label: string, admin = false) => {
    const { user: u } = await must(db.auth.admin.createUser({
      email: `support-${label}-${run}@test.local`, password, email_confirm: true, ...(admin ? { app_metadata: { role: "admin" } } : {}),
    }));
    created.users.push(u.id);
    const client = createClient<Database>(local.API_URL!, local.ANON_KEY!, { auth: { persistSession: false } });
    await must(client.auth.signInWithPassword({ email: u.email!, password }));
    return { id: u.id, email: u.email!, client: client as SupabaseClient<Database> };
  };
  const owner = await user("provider");
  const other = await user("other-provider");
  const customer = await user("customer");
  const admin1 = await user("admin1", true);
  const admin2 = await user("admin2", true);
  const provider = async (ownerId: string, name: string) => {
    const id = (await must(db.from("providers").insert({ owner_id: ownerId, display_name: name, city_id: atl.id }).select("id").single())).id;
    created.providers.push(id);
    return id;
  };
  const providerId = await provider(owner.id, `Support Test ${run}`);
  await provider(other.id, `Someone Else ${run}`);
  const ourAdmins = [admin1.id, admin2.id];
  const emailRows = async (reportId: string) => (await must(db.from("support_emails").select("kind, admin_id, provider_id, status, last_error")
    .eq("report_id", reportId))).filter((r) => r.provider_id || ourAdmins.includes(r.admin_id ?? ""));

  // 1. A report, sent as the provider: one "new report" email per admin.
  const reportId = await createSupportReport(owner.client, { category: "payments", description: `My payout hasn't arrived. ${SECRET}` });
  const report = await must(db.from("support_reports").select("provider_id, status, reporter_id").eq("id", reportId).single());
  check(report.provider_id === providerId && report.status === "todo" && report.reporter_id === owner.id,
    "1a. a report is sent as the provider's own business, by their login, as Received");
  const newRows = await emailRows(reportId);
  check(ourAdmins.every((a) => newRows.some((r) => r.kind === "admin_support_new" && r.admin_id === a)),
    "1b. it queues a \"new report\" email for every admin login");

  // 2. Sending them: to each admin, a link to the report, and never the description.
  const m1 = fakeMailer();
  await sendSupportEmails(db, m1, settings, { adminUrl: ADMIN_URL, reportId });
  const toAdmins = m1.sent.filter((e) => [admin1.email, admin2.email].includes(e.to));
  check(toAdmins.length === 2 && toAdmins.every((e) => e.subject === `New problem report from Support Test ${run}` && e.text.includes(`${ADMIN_URL}/reports/${reportId}`)),
    "2a. each admin is emailed the business's name and a link to the report");
  check(m1.sent.every((e) => !e.text.includes(SECRET) && !e.html.includes(SECRET) && !e.subject.includes(SECRET)),
    "2b. no email contains what the provider wrote");
  check(m1.sent.every((e) => e.to !== customer.email && e.to !== owner.email), "2c. only admins get the new-report email");

  // 3. A Safety report: urgent, to every admin, at once.
  const safetyId = await createSupportReport(owner.client, { category: "safety", description: `Someone threatened me at a booking. ${SECRET}` });
  const m3 = fakeMailer();
  await sendSupportEmails(db, m3, settings, { adminUrl: ADMIN_URL, reportId: safetyId });
  const urgent = m3.sent.filter((e) => [admin1.email, admin2.email].includes(e.to));
  check(urgent.length === 2 && urgent.every((e) => e.subject === `Urgent: a safety report from Support Test ${run}` && e.text.includes("911")),
    "3. a Safety report emails every admin, marked Urgent, with no details");

  // 4. Someone else's report: refused, whatever the route.
  const otherReply = await refusal(addProviderMessage(other.client, reportId, "Not mine to answer."));
  check(otherReply?.status === 403, "4a. another provider can't reply on the report");
  const otherSorted = await refusal(markSupportReportSorted(other.client, reportId));
  check(otherSorted?.status === 403, "4b. another provider can't mark it sorted");
  const otherFollows = await refusal(createSupportReport(other.client, { category: "other", description: "Following on from a report that isn't mine.", followsReportId: reportId }));
  check(otherFollows?.status === 400 && otherFollows.message === "That report isn't one of yours.", "4c. another provider can't follow on from it");
  const asCustomer = await refusal(createSupportReport(customer.client, { category: "other", description: "I'm a customer with no business at all." }));
  check(asCustomer?.status === 400 && asCustomer.message === "Only a business can report a problem.", "4d. a customer with no business can't send one");
  check((await must(db.from("support_messages").select("id").eq("report_id", reportId))).length === 0, "4e. nothing was added by the refusals");

  // 5. lokl replies (as the server writes it): the provider is emailed, without the reply.
  await must(db.from("support_reports").update({ status: "waiting" }).eq("id", reportId).select("id"));
  await must(db.from("support_messages").insert({ report_id: reportId, author_kind: "admin", author_id: admin1.id, body: `Can you send the payout date? ${SECRET}` }).select("id"));
  check((await emailRows(reportId)).some((r) => r.kind === "provider_support_reply" && r.provider_id === providerId),
    "5a. lokl's reply queues an email to the provider");
  const m5 = fakeMailer();
  await sendSupportEmails(db, m5, settings, { adminUrl: ADMIN_URL, reportId });
  const toOwner = m5.sent.filter((e) => e.to === owner.email);
  check(toOwner.length === 1 && toOwner[0]!.subject === "lokl replied to your report" && toOwner[0]!.text.includes(`${settings.siteUrl}/dashboard/help/${reportId}`),
    "5b. the provider's owner is emailed a link to the report");
  check(m5.sent.every((e) => !e.text.includes(SECRET) && !e.html.includes(SECRET)), "5c. the email never contains lokl's reply");

  // 6. The provider replies: back to "We're looking into it", and the admins are told.
  await addProviderMessage(owner.client, reportId, `It was due on Monday. ${SECRET}`);
  check((await must(db.from("support_reports").select("status").eq("id", reportId).single())).status === "in_progress",
    "6a. a reply to a report waiting for the provider moves it back to In progress");
  const m6 = fakeMailer();
  await sendSupportEmails(db, m6, settings, { adminUrl: ADMIN_URL, reportId });
  const replyMails = m6.sent.filter((e) => [admin1.email, admin2.email].includes(e.to));
  check(replyMails.length === 2 && replyMails.every((e) => e.subject === `Support Test ${run} replied to their report` && !e.text.includes(SECRET) && !e.html.includes(SECRET)),
    "6b. every admin is emailed that the provider replied, without the reply");

  // 7. "This is sorted": theirs, never a Safety report.
  await markSupportReportSorted(owner.client, reportId);
  const sorted = await must(db.from("support_reports").select("status, status_changed_by, resolved_at").eq("id", reportId).single());
  check(sorted.status === "done" && sorted.status_changed_by === "provider" && !!sorted.resolved_at, "7a. the provider closes their own report, recorded as theirs");
  const safetySorted = await refusal(markSupportReportSorted(owner.client, safetyId));
  check(safetySorted?.status === 400 && safetySorted.message === "Only lokl can close a safety report.", "7b. a Safety report can't be marked sorted by the provider");
  await addProviderMessage(owner.client, reportId, "It's come back: still missing.");
  check((await must(db.from("support_reports").select("status").eq("id", reportId).single())).status === "todo",
    "7c. a reply within 30 days reopens a resolved report");

  // 8. Resolved over 30 days ago: the reply is refused with the way forward.
  execFileSync("psql", [local.DB_URL!, "-q", "-c", `
    set session_replication_role = replica;
    update support_reports set status = 'done', resolved_at = now() - interval '31 days' where id = '${reportId}';`]);
  const late = await refusal(addProviderMessage(owner.client, reportId, "Still missing, a month on."));
  check(late?.status === 400 && late.message === "This report was resolved over 30 days ago. Start a new report about this.",
    "8a. a reply to a report resolved over 30 days ago is refused, saying to start a new one");
  const followId = await createSupportReport(owner.client, { category: "payments", description: "The same payout is missing again.", followsReportId: reportId });
  check((await must(db.from("support_reports").select("follows_report_id").eq("id", followId).single())).follows_report_id === reportId,
    "8b. the new report follows on from the old one");

  // 9. The day's limit: refused in words with the 911 line; Safety never blocked.
  for (let i = 0; i < 10; i++) {
    const e = await refusal(createSupportReport(owner.client, { category: "website", description: `The website is broken, number ${i}.` }));
    if (e) break;
  }
  const limited = await refusal(createSupportReport(owner.client, { category: "website", description: "One report too many for today." }));
  check(limited?.status === 429 && limited.message === SUPPORT_LIMIT_REPORTS, "9a. past 10 reports a day, a report is refused with the limit's words");
  const text = supportRefusalText(limited?.message ?? "", "help@lokl.test");
  check(text.includes("call 911") && text.includes("help@lokl.test"), "9b. the page's words add the 911 line and the help address");
  check(!!(await createSupportReport(owner.client, { category: "safety", description: "Safety is never refused by the limit." })),
    "9c. a Safety report still goes through");

  // 10. A login that's no longer an admin isn't emailed.
  // Queued while still an admin, demoted before sending.
  const lastId = await createSupportReport(other.client, { category: "listing", description: "My listing photos won't upload." });
  await must(db.auth.admin.updateUserById(admin2.id, { app_metadata: { role: null } }));
  const m10 = fakeMailer();
  await sendSupportEmails(db, m10, settings, { adminUrl: ADMIN_URL, reportId: lastId });
  const admin2Row = (await emailRows(lastId)).find((r) => r.admin_id === admin2.id);
  check(!m10.sent.some((e) => e.to === admin2.email) && admin2Row?.status === "skipped", "10. a login that's no longer an admin is skipped");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message}`);
} finally {
  if (created.providers.length) {
    const ids = created.providers.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from support_emails where report_id in (select id from support_reports where provider_id in (${ids}));
      delete from admin_notifications where report_id in (select id from support_reports where provider_id in (${ids}));
      delete from notifications where support_report_id in (select id from support_reports where provider_id in (${ids}));
      delete from support_report_events where report_id in (select id from support_reports where provider_id in (${ids}));
      delete from support_notes where report_id in (select id from support_reports where provider_id in (${ids}));
      delete from support_messages where report_id in (select id from support_reports where provider_id in (${ids}));
      delete from support_reports where provider_id in (${ids});
      delete from providers where id in (${ids});`]);
  }
  for (const id of created.users) await db.auth.admin.deleteUser(id);
}
console.log(failures ? `${failures} failed` : "All problem report checks passed.");
process.exit(failures ? 1 : 0);
