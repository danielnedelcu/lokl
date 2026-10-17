// The bell's sentences (notificationText in @repo/types): every kind reads
// as a sentence, and a reply to a problem report (which has no listing)
// names the report's category, never a listing.
// Run: npx tsx packages/ui/tests/notification-text.test.mts
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_ABOUT, notificationText, type NotificationKind } from "@repo/types";

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
console.log(failures ? `${failures} failed` : "All notification text checks passed.");
process.exit(failures ? 1 : 0);
