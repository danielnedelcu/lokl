// The booking emails' wording (apps/website/server/utils/bookingEmailTemplates.ts):
// every email and variant renders; nothing private or user-written gets in;
// links are absolute; the cancellation policy line matches the cancel
// dialog's rule. No network, no database.
// Run: npx tsx supabase/tests/app/booking-email-templates.test.mts

import { EMAIL_KINDS, renderEmail, renderProviderAccountEmail, staleReviewEmail } from "../../../apps/website/server/utils/bookingEmailTemplates";
import { emailSamples, SAMPLE_NOW } from "./_emailSamples";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const samples = emailSamples();
const all = samples.map((s) => ({ ...s, out: renderEmail(s.kind, s.ctx) }));
const find = (kind: string, variant = "") => all.find((a) => a.kind === kind && (!variant || a.variant === variant))!.out;

// 1. Every email renders, with a short subject and both bodies.
check(EMAIL_KINDS.every((k) => samples.some((s) => s.kind === k)), `1a. every one of the ${EMAIL_KINDS.length} email kinds has a sample`);
check(all.every((a) => a.out.subject.length > 5 && a.out.subject.length <= 80), "1b. every subject is short (80 characters at most)");
check(all.every((a) => a.out.text.length > 50 && a.out.html.startsWith("<!doctype html>")), "1c. every email has a text and an HTML version");
check(all.every((a) => a.out.text.includes("Questions? Reply to this email.") && a.out.html.includes("Questions? Reply to this email.")),
  "1d. every email says replies are welcome");

// 2. Links: absolute, to the booking page for the recipient.
const links = (s: string) => [...s.matchAll(/https?:\/\/[^\s"<)]+/g)].map((m) => m[0]);
check(all.every((a) => links(a.out.text).length > 0 && links(a.out.text).every((u) => u.startsWith("http://localhost:3100/"))),
  "2a. every link is a full address on the site");
check(all.filter((a) => a.kind.startsWith("customer_")).every((a) => a.out.text.includes("/account/bookings/")),
  "2b. customer emails link to the customer's booking page");
check(all.filter((a) => a.kind.startsWith("provider_") && a.kind !== "provider_payout_problem").every((a) => a.out.text.includes("/dashboard/bookings/")),
  "2c. provider emails link to the provider's booking page");
check(find("provider_payout_problem").text.includes("/dashboard/payouts"), "2d. the payout problem email links to payout settings");

// 3. Nothing private: only the customer's first name, and only to providers.
check(all.every((a) => !a.out.text.includes("Example") && !a.out.html.includes("Example")), "3a. the customer's last name is never in an email");
check(all.filter((a) => a.kind.startsWith("customer_")).every((a) => !a.out.text.includes("Jordan")), "3b. customer emails don't name the customer");
check(["provider_new_request", "provider_new_booking"].every((k) => find(k).text.includes("Jordan")), "3c. provider emails use the customer's first name");
check(all.every((a) => !/@/.test(a.out.text.replace(/https?:\/\/\S+/g, ""))), "3d. no email address appears in any email");

// 4. Escaping: a listing title can't inject HTML.
const evil = { ...samples[0]!.ctx, listing: { ...samples[0]!.ctx.listing, title: `<script>alert("x")</script> & co` } };
const ev = renderEmail("customer_request_sent", evil);
check(!ev.html.includes("<script>") && ev.html.includes("&lt;script&gt;"), "4. HTML in a listing title is shown as text, not run");

// 5. The policy line on "accepted" and "you're booked" follows the cancel dialog's rule.
check(find("customer_booking_confirmed", "booked well ahead").text.includes("Free cancellation until 48 hours before"),
  "5a. booked well ahead: free cancellation until 48 hours before");
const grace = find("customer_booking_confirmed", "booked inside 48 hours (grace hour)").text;
check(grace.includes("cancel for free until") && grace.includes("12:00 PM") && grace.includes("no refund"),
  "5b. booked inside 48 hours: free until the grace hour ends (12:00 PM Atlanta time, an hour after booking), then no refund");
check(find("customer_request_accepted", "accepted inside 48 hours (grace hour)").text.includes("cancel for free until"),
  "5c. a Service accepted inside 48 hours gets the grace hour, from when it was accepted");
// Booked at 11:00 AM for 11:27 AM: free until 11:27 AM (the start), not 12:00 PM.
const lastMinute = find("customer_booking_confirmed", "booked less than an hour before the start").text;
check(lastMinute.includes("cancel for free until it starts, at Tue, Oct 6, 11:27 AM (Atlanta time)") && !lastMinute.includes("12:00 PM"),
  "5d. booked less than an hour before the start: free until the start time, not an hour after booking");

// 6. The particulars asked for.
const req = find("provider_new_request").text;
check(["First choice", "Second choice", "Third choice"].every((c) => req.includes(c)), "6a. the new-request email lists all the offered times");
check(["customer_request_declined", "customer_request_expired"].every((k) => all.filter((a) => a.kind === k).every((a) => a.out.text.includes("/atlanta/services/hair-and-beauty"))),
  "6b. declined and didn't-go-through emails link to similar listings");
check(find("customer_request_expired", "card couldn't be charged").text.includes("couldn't charge your card"), "6c. the card variant says the card failed, not that nobody answered");
check(find("customer_booking_cancelled", "you cancelled, no refund").text.includes("no refund") && find("provider_booking_cancelled", "customer cancelled late").text.includes("still receive"),
  "6d. a late cancellation tells the customer there's no refund and the provider they'll still be paid");
check(all.every((a) => a.out.text.includes("(Atlanta time)") || !/\d:\d\d [AP]M/.test(a.out.text)), "6e. every time shown says it's Atlanta time");

// 6f. lokl cancelling after the payout tells the provider what happened to their share.
const back = find("provider_booking_cancelled", "lokl cancelled after the payout (taken back)").text;
const owed = find("provider_booking_cancelled", "lokl cancelled after the payout (owed)").text;
const plainCancel = find("provider_booking_cancelled", "lokl cancelled").text;
check(back.includes("$104.00 we'd sent you for it has been taken back from your Stripe balance"), "6f. after a payout, the provider is told their share was taken back");
check(owed.includes("couldn't take back the $104.00") && owed.includes("you owe it to lokl"), "6g. ...or, if that failed, that they owe it");
check(!plainCancel.includes("taken back") && !plainCancel.includes("owe"), "6h. before a payout, neither is mentioned");

// 6i. The provider's cancellation subject is its own, and says what it means for them.
const pc = (v: string) => all.find((a) => a.kind === "provider_booking_cancelled" && a.variant === v)!.out.subject;
const cc = (v: string) => all.find((a) => a.kind === "customer_booking_cancelled" && a.variant === v)!.out.subject;
check(pc("customer cancelled in time") === "Booking cancelled: Sweet Auburn food walk on Sat, Oct 10, no payout", `6i. in time: "${pc("customer cancelled in time")}"`);
check(pc("customer cancelled late") === "Booking cancelled: Sweet Auburn food walk on Wed, Oct 7, you'll still be paid", `6j. late: "${pc("customer cancelled late")}"`);
check(pc("customer withdrew a request") === "Request withdrawn: Silk press and trim" && pc("lokl cancelled").endsWith(", no payout")
  && pc("lokl cancelled after the payout (taken back)").endsWith(", payout taken back") && pc("lokl cancelled after the payout (owed)").endsWith(", payout owed back"),
  "6k. a withdrawn request, and each lokl cancellation, say so in the subject");
check(all.filter((a) => a.kind === "provider_booking_cancelled").every((a) => a.out.subject !== cc("you cancelled, refunded") && a.out.subject.length <= 80),
  "6l. no provider cancellation shares the customer's subject, and all stay short");

// 7. The provider account emails (paused, active again).
const site = "http://localhost:3100";
const paused = renderProviderAccountEmail("provider_account_paused", { siteUrl: site, businessName: "Fresh Cuts Studio", message: "Please call us about\nthe last two bookings." });
const pausedPlain = renderProviderAccountEmail("provider_account_paused", { siteUrl: site, businessName: "Fresh Cuts Studio", message: null });
const active = renderProviderAccountEmail("provider_account_active", { siteUrl: site, businessName: "Fresh Cuts Studio", message: "   " });
check(paused.subject === "Your lokl account is paused" && active.subject === "Your lokl account is active again", "7a. the two subjects, as approved");
check(["Your listings are hidden", "have been withdrawn", "payouts are on hold", "still go ahead, unless we tell you otherwise",
  "If you can't do one, cancel it from your dashboard, and the customer gets a full refund."].every((t) => paused.text.includes(t)),
  "7b. the paused email says what's hidden, withdrawn and held, and how to cancel a confirmed booking");
check(paused.text.includes("A message from lokl:\nPlease call us about\nthe last two bookings.") && paused.html.includes("A message from lokl"),
  "7c. lokl's message is included when written, line breaks and all");
check(!pausedPlain.text.includes("A message from lokl") && !active.text.includes("A message from lokl"), "7d. with no message (or only spaces), there's no message section");
const evilMsg = renderProviderAccountEmail("provider_account_paused", { siteUrl: site, businessName: "Fresh Cuts Studio", message: "<img src=x onerror=alert(1)>" });
check(!evilMsg.html.includes("<img") && evilMsg.html.includes("&lt;img"), "7e. HTML in the message is shown as text, not run");
check(active.text.includes("stay on hold while we review them") && active.text.includes("/dashboard"), "7f. the active email says held payouts stay held, and links to the dashboard");
check([paused, active].every((e) => e.text.includes("Questions? Reply to this email.") && e.text.includes("you have a provider account on lokl")),
  "7g. both invite replies and say why the provider is getting them");

// 8. Profile content removed (docs/design/provider-profiles.md).
const edited = renderProviderAccountEmail("provider_profile_edited", {
  siteUrl: site, businessName: "Fresh Cuts Studio", message: "Please add your photo again without the phone number.",
  removed: ["avatar", "bio"], rule: "contact_details",
});
check(edited.subject === "We've removed part of your lokl profile", "8a. the subject says part of the profile was removed");
check(edited.text.includes("Your profile photo") && edited.text.includes("The \"About you\" text") && !edited.text.includes("Your headline"),
  "8b. it lists exactly what was removed");
check(edited.text.includes("The rule it didn't follow: Phone numbers, email addresses or web addresses."), "8c. it names the rule, in its written words");
check(edited.text.includes("A message from lokl:\nPlease add your photo again") && edited.text.includes("/dashboard/settings"),
  "8d. lokl's message is included, and the button goes to the profile settings");

// 9. Reviews (docs/design/reviews.md).
const req9 = find("customer_review_request");
check(req9.subject === "How was Sweet Auburn food walk?" && req9.text.includes("/account/bookings/00000000-0000-4000-8000-000000000001#review"),
  "9a. the request asks how it was, and links to the review form");
check(req9.text.includes("until Sun, Oct 18") && req9.text.includes("first name and last initial") && req9.text.includes("/review-rules"),
  "9b. ...says until when, how the name shows, and links to the rules");
const allReview = all.filter((a) => a.kind.includes("review") || a.kind.includes("reply"));
check(allReview.every((a) => !/discount|gift|reward|voucher|coupon|free|good review|5 stars|five-star/i.test(a.out.text.replace(/one to five stars|\d out of 5 stars/g, ""))),
  "9c. no review email offers anything or asks for a good review");
check(find("customer_review_reminder").subject === "4 days left to review Sweet Auburn food walk", "9d. the reminder says how long is left");
const removed9 = find("customer_review_removed");
check(removed9.text.includes("shares private information") && removed9.text.includes("never for being negative"), "9e. a removal names the rule, and says negative reviews stay");
check(find("provider_new_review").text.includes("4 out of 5 stars") && find("provider_new_review").text.includes("#review"), "9f. the provider hears the stars and where to reply");
check(find("provider_reply_removed").text.includes("is abusive") && find("provider_reply_removed").text.includes("write a new one"), "9g. a removed reply names the rule, and says they can write again");
const base9 = all.find((a) => a.kind === "customer_review_request")!.ctx;
const now9 = new Date(SAMPLE_NOW);
check(staleReviewEmail("customer_review_request", base9, now9) === null, "9h. a request for a qualifying booking goes out");
check(staleReviewEmail("customer_review_reminder", { ...base9, review: { rating: 5, status: "published", removedRule: null, replyStatus: null, replyRemovedRule: null } }, now9) === "Already reviewed.",
  "9i. ...not once reviewed");
check(staleReviewEmail("customer_review_request", { ...base9, booking: { ...base9.booking, cancelled_at: base9.booking.ends_at } }, now9) !== null, "9j. ...not for a cancelled booking");
check(staleReviewEmail("customer_review_reminder", base9, new Date(SAMPLE_NOW + 15 * 86_400_000)) === "The 14 days to review have passed.", "9k. ...not after the window");
check(staleReviewEmail("customer_review_removed", { ...base9, review: { rating: 2, status: "published", removedRule: null, replyStatus: null, replyRemovedRule: null } }, now9) !== null,
  "9l. a removal email isn't sent once the review is restored");

console.log(failures ? `${failures} failed` : `All email template checks passed (${all.length} booking emails, 3 account emails).`);
process.exit(failures ? 1 : 0);
