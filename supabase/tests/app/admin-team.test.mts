// The team, the server's side (admin roles, step 5a; docs/design/admin-roles.md):
// the website's invitation (server/utils/adminTeam.ts) as the owner's and
// support's sessions, and the team's emails sent with a fake mailer
// (sendAdminEmails), against the LOCAL stack. An invitation goes to the
// person invited and links to the admin sign-in; every team change goes to
// every owner and links to the Team page; neither carries the reason. No
// real email is sent.
// Run: npx tsx supabase/tests/app/admin-team.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@repo/types";
import { sendAdminEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";
import { inviteToTeam } from "../../../apps/website/server/utils/adminTeam";
import { BookingError } from "../../../apps/website/server/utils/bookings";
import { forgetTestAdmins, makeAdmin } from "./_admin.mts";

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
async function refusal(p: Promise<unknown>): Promise<BookingError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof BookingError) return e;
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
// The reasons: none may reach an email.
const SECRET = `private-reason-${run}`;
const email = (label: string) => `team-${label}-${run}@test.local`;

try {
  const owner = await makeAdmin(local, email("owner"));
  const support = await makeAdmin(local, email("support"), { role: "support" });

  // ---- 1. Inviting ----------------------------------------------------------
  const newId = await inviteToTeam(owner.server, owner.id, { email: email("new"), role: "support", reason: `${SECRET} new` });
  const { data: made } = await db.auth.admin.getUserById(newId);
  check(made.user?.email === email("new") && !!made.user?.email_confirmed_at, "1a. the owner's invitation makes a login, confirmed, for the email given");
  const { data: row } = await db.from("admin_members").select("role, status, invited_by").eq("user_id", newId).single();
  check(row?.role === "support" && row.status === "invited" && row.invited_by === owner.id, "1b. ...and an invited support member");

  const { data: existing } = await db.auth.admin.createUser({ email: email("customer"), email_confirm: true });
  const sameId = await inviteToTeam(owner.server, owner.id, { email: email("customer"), role: "owner", reason: `${SECRET} customer` });
  check(sameId === existing.user!.id, "1c. an email that already has a login keeps it (a customer's)");

  const bySupport = await refusal(inviteToTeam(support.server, support.id, { email: email("other"), role: "support", reason: `${SECRET} other` }));
  check(bySupport?.status === 403 && bySupport.message === "Only the owner can invite someone to the team.", "1d. support is refused, with the plain message");
  const again = await refusal(inviteToTeam(owner.server, owner.id, { email: email("support"), role: "support", reason: `${SECRET} again` }));
  check(again?.status === 400 && again.message === "They're on the team already.", "1e. someone already on the team: refused, plainly");

  // ---- 2. The emails ----------------------------------------------------------
  const mailer = fakeMailer();
  // Only this test's people: other tests leave team emails waiting in the shared outbox.
  const ours = [owner.id, support.id, newId, sameId];
  await sendAdminEmails(db, mailer, settings, { adminUrl: ADMIN_URL, recipients: ours });
  const to = (address: string) => mailer.sent.filter((e) => e.to === address);
  const inviteMail = to(email("new"));
  check(inviteMail.length === 1 && inviteMail[0]!.subject === "You're invited to the lokl admin team", "2a. the person invited gets one invitation");
  check(inviteMail[0]!.text.includes(`${email("owner")} invited you to the lokl admin team as support.`) && inviteMail[0]!.text.includes(`${ADMIN_URL}/login`),
    "2b. ...saying who invited them, as what, linking to the admin sign-in");
  const ownerMail = to(email("owner"));
  check(ownerMail.some((e) => e.subject === "A change to the lokl admin team" && e.text.includes(`${email("owner")} invited ${email("new")} to the team as support.`) && e.text.includes(`${ADMIN_URL}/team`)),
    "2c. the owner is told of their own invitation, with a link to the Team page");
  check(ownerMail.some((e) => e.text.includes(`invited ${email("customer")} to the team as owner.`)), "2d. ...and of each one");
  check(to(email("support")).length === 0, "2e. support isn't emailed team changes");
  check(mailer.sent.every((e) => !e.text.includes(SECRET) && !e.html.includes(SECRET)), "2f. no email carries the reason");
  const second = fakeMailer();
  await sendAdminEmails(db, second, settings, { adminUrl: ADMIN_URL, recipients: ours });
  check(second.sent.every((e) => !e.to.endsWith(`-${run}@test.local`)), "2g. a second run sends none of them again");

  // ---- 3. An invitation withdrawn before it went out ---------------------------
  const lateId = await inviteToTeam(owner.server, owner.id, { email: email("late"), role: "support", reason: `${SECRET} late` });
  const removed = await owner.client.rpc("admin_remove", { p_user_id: lateId, p_reason: `${SECRET} withdrawn` });
  check(!removed.error, "3a. the owner cancels an invitation");
  const late = fakeMailer();
  await sendAdminEmails(db, late, settings, { adminUrl: ADMIN_URL, recipients: [...ours, lateId] });
  check(late.sent.every((e) => e.to !== email("late")), "3b. the invitation isn't sent once it's withdrawn");
  const { data: skipped } = await db.from("admin_emails").select("status, skip_reason").eq("recipient_id", lateId).eq("kind", "admin_invite").single();
  check(skipped?.status === "skipped" && skipped.skip_reason === "No longer invited.", "3c. ...it's marked skipped, saying why");
  check(late.sent.some((e) => e.to === email("owner") && e.text.includes(`${email("owner")} removed ${email("late")} from the team.`)), "3d. the owner is told of the removal");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message}`);
} finally {
  // Team rows, their alerts, emails and log rows are never deleted by the
  // apps; the local clean-up goes round the guards (LOCAL database only),
  // for every login this run made; then the test admins' own rows.
  if (/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//.test(local.DB_URL ?? "")) {
    const ours = `select id from auth.users where email like 'team-%-${run}@test.local'`;
    const actions = `select id from admin_actions where target = 'admin_member' and (target_id in (${ours}) or admin_id in (${ours}))`;
    execFileSync("psql", [local.DB_URL!, "-q", "-v", "ON_ERROR_STOP=1", "-c", `
      set session_replication_role = replica;
      delete from admin_notifications where admin_action_id in (${actions});
      delete from admin_emails where admin_action_id in (${actions});
      delete from admin_actions where id in (${actions});
      delete from admin_members where user_id in (${ours});
      delete from auth.users where id in (${ours});`]);
  }
  forgetTestAdmins();
}
console.log(failures ? `${failures} failed` : "All team checks passed.");
process.exit(failures ? 1 : 0);
