// The booking emails' wording (apps/website/server/utils/bookingEmailTemplates.ts):
// every email and variant renders; nothing private or user-written gets in;
// links are absolute; the cancellation policy line matches the cancel
// dialog's rule. No network, no database.
// Run: npx tsx supabase/tests/app/booking-email-templates.test.mts

import { EMAIL_KINDS, renderEmail } from "../../../apps/website/server/utils/bookingEmailTemplates";
import { emailSamples } from "./_emailSamples";

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

console.log(failures ? `${failures} failed` : `All email template checks passed (${all.length} emails).`);
process.exit(failures ? 1 : 0);
