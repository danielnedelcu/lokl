// The bell's sentences (notificationText in @repo/types): every kind reads
// as a sentence, and a reply to a problem report (which has no listing)
// names the report's category, never a listing. The owners' team changes
// (adminTeamChangeText) and support's requests (adminRequestNewText,
// adminRequestDecidedText) read as sentences too.
// Run: npx tsx packages/ui/tests/notification-text.test.mts
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_ABOUT, adminLimitReachedText, adminRequestDecidedText, adminRequestNewText, adminSupportRefundText, adminTeamChangeText, notificationText, type AdminRequestKind, type AdminRequestStatus, type AdminTeamAction, type NotificationKind } from "@repo/types";

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

// Support's requests.
const booking = { listingTitle: "Taco crawl", providerName: "Tours and Cuts" };
const REQ: AdminRequestKind[] = ["refund", "release_payout", "resolve_problem_paid", "suspend_provider", "reinstate_provider"];
const STATUSES: AdminRequestStatus[] = ["pending", "approved", "declined", "withdrawn", "expired", "done_by_owner"];
check(REQ.every((k) => /\.$/.test(adminRequestNewText("sam@example.com", { kind: k, amountCents: 19500, ...booking })))
  && STATUSES.every((st) => REQ.every((k) => /^[A-Z].*\.$/.test(adminRequestDecidedText(st, { kind: k, amountCents: 19500, ...booking })))),
  "r1. every request, new or decided, is a sentence");
check(adminRequestNewText("sam@example.com", { kind: "refund", amountCents: 19500, ...booking }) === "sam@example.com asks you to refund $195.00 for “Taco crawl” (Tours and Cuts).",
  "r2. a refund request says the amount and the booking");
check(adminRequestDecidedText("approved", { kind: "suspend_provider", ...booking }) === "The owner approved your request to suspend Tours and Cuts.", "r3. a decision says what was asked");
check(adminRequestNewText("sam@example.com", { kind: "resolve_problem_paid", ...booking }) === "sam@example.com asks you to pay Tours and Cuts for “Taco crawl”, resolving a no-show report.",
  "r4. paying the provider names them once");

// Daily limits and support's refunds, for the owners (step 5c).
check(adminLimitReachedText("sam@example.com", "contact_views") === "sam@example.com reached today's limit for contact details.", "l1. a limit reached names it");
check(adminSupportRefundText("sam@example.com", { amountCents: 13000, resolvedReport: false, ...booking })
  === "sam@example.com refunded $130.00 and cancelled “Taco crawl” (Tours and Cuts).", "l2. support's refund says how much, and which booking");
check(adminSupportRefundText("sam@example.com", { amountCents: 0, resolvedReport: false, ...booking }) === "sam@example.com cancelled “Taco crawl” (Tours and Cuts).",
  "l3. a cancellation with no refund (a card hold) says so");
check(adminSupportRefundText("sam@example.com", { amountCents: 6500, resolvedReport: true, ...booking }).endsWith("resolving a no-show report."), "l4. a report resolved with a refund says so");

console.log(failures ? `${failures} failed` : "All notification text checks passed.");
process.exit(failures ? 1 : 0);
