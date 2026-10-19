// The bell's sentences (notificationText in @repo/types): every kind reads
// as a sentence, and a reply to a problem report (which has no listing)
// names the report's category, never a listing. The owners' team changes
// (adminTeamChangeText) read as sentences too, from the log's own message.
// Run: npx tsx packages/ui/tests/notification-text.test.mts
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_ABOUT, adminTeamChangeText, notificationText, type AdminTeamAction, type NotificationKind } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const KINDS: NotificationKind[] = [
  "listing_approved", "listing_rejected", "listing_unpublished", "listing_restored",
  "booking_requested", "booking_confirmed", "booking_cancelled", "booking_problem_reported",
  "review_posted", "support_reply",
];
check(KINDS.every((k) => /\.$/.test(notificationText(k, "Taco crawl"))), "1. every kind is a sentence");
check(notificationText("support_reply", SUPPORT_CATEGORY_ABOUT.payments) === "lokl replied to your report about payments and payouts.",
  "2. a reply to a report names its category");
check(SUPPORT_CATEGORIES.every((c) => !notificationText("support_reply", SUPPORT_CATEGORY_ABOUT[c]).includes("“")),
  "3. ...without quoting it like a listing's title");
// The owners' team changes.
const TEAM: AdminTeamAction[] = ["invite_admin", "change_admin_role", "remove_admin", "reset_admin_mfa", "join_admin", "break_glass_owner"];
check(TEAM.every((a) => /\.$/.test(adminTeamChangeText(a, "You", "sam@example.com", null))), "t1. every team change is a sentence, even without a message");
check(adminTeamChangeText("invite_admin", "You", "sam@example.com", "as support") === "You invited sam@example.com to the team as support.", "t2. an invitation says the role");
check(adminTeamChangeText("change_admin_role", "alex@example.com", "sam@example.com", "support to owner") === "alex@example.com changed sam@example.com's role from support to owner.",
  "t3. a role change says from what to what");
check(adminTeamChangeText("join_admin", "sam@example.com", "sam@example.com", null) === "sam@example.com joined the team.", "t4. joining names the person once");

console.log(failures ? `${failures} failed` : "All notification text checks passed.");
process.exit(failures ? 1 : 0);
