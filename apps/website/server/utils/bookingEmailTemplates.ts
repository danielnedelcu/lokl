// The booking emails' wording (docs/design/booking-and-checkout.md, Emails;
// step 4 part 7). Each email: a subject, a plain-text body and a simple
// HTML body. Short, plain sentences, one button to the booking page.
//
// Never in an email (they get forwarded): addresses, phone numbers, email
// addresses, notes, and anything people wrote themselves (cancel reasons,
// no-show notes). The customer's first name is the one personal detail, in
// provider emails only (decided 2026-10-02). The rest is on the signed-in
// booking page the button opens.
//
// Plain TypeScript with no Nuxt imports: the sender, the tests and
// `npm run email:previews` all use these same functions.

import { customerCancelOutcome, PROFILE_RULES, REVIEW_RULES, type ProfileRule, type ReviewRule } from "@repo/types";

export const EMAIL_KINDS = [
  "customer_request_sent", "customer_request_accepted", "customer_request_declined", "customer_request_expired",
  "customer_booking_confirmed", "customer_booking_cancelled", "customer_problem_received", "customer_problem_refunded",
  "provider_new_request", "provider_new_booking", "provider_booking_cancelled", "provider_request_unanswered",
  "provider_payout_sent", "provider_problem_reported", "provider_payout_problem",
  "provider_problem_paid", "provider_problem_refunded",
  "customer_review_request", "customer_review_reminder", "customer_review_removed", "provider_new_review", "provider_reply_removed",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailContext {
  siteUrl: string;
  booking: {
    id: string;
    kind: "service" | "experience";
    status: string;
    starts_at: string | null;
    confirmed_at: string | null;
    respond_by: string | null;
    preferred_times: string[] | null;
    party_size: number;
    total_cents: number;
    provider_amount_cents: number;
    refunded_cents: number;
    cancelled_by: string | null;
    status_changed_by: string;
    customer_name: string;
    /** For the review emails: the 14 days to review count from the end. */
    ends_at?: string | null;
    cancelled_at?: string | null;
    problem_reported_at?: string | null;
    problem_resolution?: string | null;
    /** lokl cancelled after the payout: the provider's share was taken back, or couldn't be. */
    stripe_transfer_reversal_id?: string | null;
    reversal_failed_at?: string | null;
  };
  listing: { title: string; kind: "service" | "experience"; categorySlug: string | null; marketSlug: string; marketName: string; timezone: string };
  provider: { name: string };
  /** The booking's review, if any (docs/design/reviews.md). Never its words: emails get forwarded. */
  review?: {
    rating: number;
    status: "published" | "removed";
    removedRule: ReviewRule | null;
    replyStatus: "published" | "removed" | null;
    replyRemovedRule: ReviewRule | null;
  } | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * A review email that no longer applies, with why (else null): a request or
 * reminder once reviewed, past the window, or for a booking that no longer
 * qualifies; a removal email once it's been restored; a new-review email
 * once the review was deleted.
 */
export function staleReviewEmail(kind: EmailKind, ctx: EmailContext, now = new Date()): string | null {
  const b = ctx.booking;
  if (kind === "customer_review_request" || kind === "customer_review_reminder") {
    if (ctx.review) return "Already reviewed.";
    if (b.cancelled_at || !["completed", "paid_out"].includes(b.status)) return "The booking can't be reviewed.";
    if (b.problem_reported_at && b.problem_resolution !== "paid_provider") return "A no-show report is open.";
    if (!b.ends_at || now.getTime() >= Date.parse(b.ends_at) + 14 * 86_400_000) return "The 14 days to review have passed.";
  }
  if (kind === "customer_review_removed" && ctx.review?.status !== "removed") return "The review isn't removed any more.";
  if (kind === "provider_reply_removed" && ctx.review?.replyStatus !== "removed") return "The reply isn't removed any more.";
  if (kind === "provider_new_review" && !ctx.review) return "The review was deleted.";
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function dateOnly(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(iso));
}
function dateTime(iso: string, tz: string, marketName: string) {
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  return `${dateOnly(iso, tz)}, ${time} (${marketName} time)`;
}
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "The customer";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// One email, built from paragraphs, an optional "When / People" list, one
// button and an optional text link under it.
interface Parts {
  subject: string;
  intro: string[];
  bullets?: string[];
  facts?: [string, string][];
  after?: string[];
  /** lokl's own words to the person (provider account emails), shown as written. */
  message?: string | null;
  button: { label: string; url: string };
  link?: { label: string; url: string };
  recipient: "customer" | "provider" | "account";
}

function render(p: Parts): RenderedEmail {
  const why = p.recipient === "customer"
    ? "You're getting this because of a booking on lokl."
    : p.recipient === "provider"
      ? "You're getting this because of a booking on your lokl listing."
      : "You're getting this because you have a provider account on lokl.";
  const footer = ["Questions? Reply to this email.", "lokl · Services and Experiences from local people in Atlanta.", why];

  const text = [
    ...p.intro,
    ...(p.bullets?.length ? [p.bullets.map((b) => `- ${b}`).join("\n")] : []),
    ...(p.facts?.length ? [p.facts.map(([k, v]) => `${k}: ${v}`).join("\n")] : []),
    ...(p.after ?? []),
    ...(p.message ? [`A message from lokl:\n${p.message}`] : []),
    `${p.button.label}: ${p.button.url}`,
    ...(p.link ? [`${p.link.label}: ${p.link.url}`] : []),
    "--",
    footer.join("\n"),
  ].join("\n\n");

  const para = (t: string) => `<p style="margin:0 0 16px">${escape(t)}</p>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(p.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111111">
<p style="margin:0 0 24px;font-size:20px;font-weight:600">lokl</p>
${p.intro.map(para).join("\n")}
${p.bullets?.length ? `<ul style="margin:0 0 16px;padding-left:20px">${p.bullets.map((b) => `<li style="margin:0 0 6px">${escape(b)}</li>`).join("")}</ul>` : ""}
${p.facts?.length ? `<table role="presentation" style="margin:0 0 16px;border-collapse:collapse">${p.facts.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#555555;vertical-align:top">${escape(k)}</td><td style="padding:2px 0">${escape(v)}</td></tr>`).join("")}</table>` : ""}
${(p.after ?? []).map(para).join("\n")}
${p.message ? `<div style="margin:0 0 16px;padding:12px 16px;background:#f4f4f5;border-radius:6px"><p style="margin:0 0 4px;font-weight:600">A message from lokl</p><p style="margin:0;white-space:pre-line">${escape(p.message)}</p></div>` : ""}
<p style="margin:24px 0 8px"><a href="${escape(p.button.url)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 20px;background:#111111;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${escape(p.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:14px;color:#555555">Or open: <a href="${escape(p.button.url)}" style="color:#111111">${escape(p.button.url)}</a></p>
${p.link ? `<p style="margin:0 0 16px"><a href="${escape(p.link.url)}" style="color:#111111">${escape(p.link.label)}</a></p>` : ""}
<hr style="border:none;border-top:1px solid #dddddd;margin:24px 0 16px">
${footer.map((l) => `<p style="margin:0 0 4px;font-size:14px;color:#555555">${escape(l)}</p>`).join("\n")}
</div>
</body></html>`;
  return { subject: p.subject, text, html };
}

// ---------------------------------------------------------------------------
// The policy line on "accepted" and "you're booked": the same rule as the
// cancel dialog (customerCancelOutcome), as it stood when the booking was
// confirmed.
// ---------------------------------------------------------------------------

export function policyLine(b: EmailContext["booking"], tz: string, marketName: string): string {
  if (!b.starts_at || !b.confirmed_at) return "Free cancellation until 48 hours before.";
  const o = customerCancelOutcome({ status: "confirmed", starts_at: b.starts_at, confirmed_at: b.confirmed_at }, Date.parse(b.confirmed_at));
  if (o.kind === "full_refund" && o.reason === "grace") {
    // Booked less than an hour before the start: free until it starts.
    if (o.graceEndsAtStart) {
      return `You booked less than an hour before the start, so you can cancel for free until it starts, at ${dateTime(o.graceEndsAt!, tz, marketName)}.`;
    }
    return `You booked less than 48 hours before the start, so you can cancel for free until ${dateTime(o.graceEndsAt!, tz, marketName)}. After that, there's no refund.`;
  }
  const until = new Date(Date.parse(b.starts_at) - 48 * 3600_000).toISOString();
  return `Free cancellation until 48 hours before: ${dateTime(until, tz, marketName)}.`;
}

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

export function renderEmail(kind: EmailKind, c: EmailContext): RenderedEmail {
  const { booking: b, listing: l, provider } = c;
  const tz = l.timezone;
  const at = (iso: string) => dateTime(iso, tz, l.marketName);
  const when = b.starts_at ? at(b.starts_at) : "";
  const date = b.starts_at ? dateOnly(b.starts_at, tz) : "";
  const customerUrl = `${c.siteUrl}/account/bookings/${b.id}`;
  const providerUrl = `${c.siteUrl}/dashboard/bookings/${b.id}`;
  const plural = l.kind === "experience" ? "experiences" : "services";
  const similar = {
    label: l.kind === "experience" ? "Browse similar Experiences" : "Browse similar Services",
    url: l.categorySlug ? `${c.siteUrl}/${l.marketSlug}/${plural}/${l.categorySlug}` : `${c.siteUrl}/${l.marketSlug}/${plural}`,
  };
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const name = firstName(b.customer_name);

  switch (kind) {
    // ----------------------------------------------------------- customer
    case "customer_request_sent":
      return render({
        recipient: "customer",
        subject: `Request sent: ${l.title}`,
        intro: [
          `We've sent your request to ${provider.name}. They have until ${b.respond_by ? at(b.respond_by) : "48 hours from now"} to accept one of the times you offered.`,
          `Your card is on hold for ${money(b.total_cents)}. You won't be charged unless they accept.`,
        ],
        button: { label: "See your request", url: customerUrl },
      });
    case "customer_request_accepted":
      return render({
        recipient: "customer",
        subject: `Accepted: ${l.title} on ${date}`,
        intro: [`${provider.name} accepted your request.`],
        facts: [["When", when]],
        after: [`You were charged ${money(b.total_cents)}. The address and details are on your booking page.`, policyLine(b, tz, l.marketName)],
        button: { label: "See your booking", url: customerUrl },
      });
    case "customer_request_declined":
      return render({
        recipient: "customer",
        subject: `Not available: ${l.title}`,
        intro: [
          b.status_changed_by === "system"
            ? "This Service isn't available any more, so your request was cancelled."
            : `${provider.name} can't take your request this time.`,
          "The hold on your card is released, so you weren't charged.",
        ],
        button: { label: "See your request", url: customerUrl },
        link: similar,
      });
    case "customer_request_expired":
      return render({
        recipient: "customer",
        subject: `Your request for ${l.title} didn't go through`,
        intro: [
          b.status_changed_by === "system"
            ? `${provider.name} didn't answer in time, so your request has ended.`
            : `We couldn't charge your card when ${provider.name} accepted, so your request has ended.`,
          b.refunded_cents > 0 ? `We've refunded ${money(b.refunded_cents)} to your card.` : "Nothing was charged.",
        ],
        button: { label: "See your request", url: customerUrl },
        link: similar,
      });
    case "customer_booking_confirmed":
      return render({
        recipient: "customer",
        subject: `You're booked: ${l.title} on ${date}`,
        intro: [`You're booked for ${l.title} with ${provider.name}.`],
        facts: [["When", when], ["People", people(b.party_size)]],
        after: [`You paid ${money(b.total_cents)}. The meeting point and details are on your booking page.`, policyLine(b, tz, l.marketName)],
        button: { label: "See your booking", url: customerUrl },
      });
    case "customer_booking_cancelled": {
      const wasRequest = !b.confirmed_at;
      let first: string;
      if (b.cancelled_by === "customer") {
        first = wasRequest
          ? "You cancelled your request. The hold on your card is released, so you weren't charged."
          : b.refunded_cents > 0
            ? `You cancelled your booking. We've refunded ${money(b.refunded_cents)} to your card. Refunds can take a few business days to appear.`
            : "You cancelled less than 48 hours before, so there's no refund.";
      } else if (b.cancelled_by === "provider") {
        first = `${provider.name} had to cancel. We've refunded ${money(b.refunded_cents)} in full. Their message is on your booking page.`;
      } else {
        first = wasRequest
          ? "Your request was cancelled. The hold on your card is released, so you weren't charged."
          : `This booking was cancelled. We've refunded ${money(b.refunded_cents)} in full.`;
      }
      return render({
        recipient: "customer",
        subject: date ? `Cancelled: ${l.title} on ${date}` : `Cancelled: ${l.title}`,
        intro: [first],
        button: { label: wasRequest ? "See your request" : "See your booking", url: customerUrl },
      });
    }
    case "customer_problem_received":
      return render({
        recipient: "customer",
        subject: `We got your report about ${l.title}`,
        intro: [`Thanks for telling us. We're holding ${provider.name}'s payment while we look into it, and we'll email you about what happens next.`],
        button: { label: "See your booking", url: customerUrl },
      });

    // A no-show report resolved with a refund (decided 2026-10-03: the
    // customer hears only about a refund; the provider hears either way).
    case "customer_problem_refunded":
      return render({
        recipient: "customer",
        subject: `Refunded: your report about ${l.title}`,
        intro: [
          `We looked into the problem you reported with ${l.title}${date ? ` on ${date}` : ""}, and we've refunded ${money(b.refunded_cents || b.total_cents)} to your card in full. Refunds can take a few business days to appear.`,
          "Thanks for telling us.",
        ],
        button: { label: "See your booking", url: customerUrl },
      });

    // ----------------------------------------------------------- provider
    case "provider_problem_paid":
      return render({
        recipient: "provider",
        subject: `You'll be paid for ${l.title}`,
        intro: [
          `We looked into the problem ${name} reported with their booking for ${l.title}${date ? ` on ${date}` : ""}. You'll be paid ${money(b.provider_amount_cents)} as usual. We'll email you when it's sent.`,
        ],
        button: { label: "See the booking", url: providerUrl },
      });
    case "provider_problem_refunded":
      return render({
        recipient: "provider",
        subject: `Refunded after a reported problem: ${l.title}`,
        intro: [
          `We looked into the problem ${name} reported with their booking for ${l.title}${date ? ` on ${date}` : ""}, and refunded them in full. You won't be paid for this booking.`,
        ],
        button: { label: "See the booking", url: providerUrl },
      });
    case "provider_new_request":
      return render({
        recipient: "provider",
        subject: `New request: ${l.title}`,
        intro: [
          `${name} sent a request for ${l.title}. Please accept one of the times offered, or decline, by ${b.respond_by ? at(b.respond_by) : "48 hours from now"}.`,
        ],
        facts: (b.preferred_times ?? []).map((t, i) => [i === 0 ? "First choice" : i === 1 ? "Second choice" : "Third choice", at(t)] as [string, string]),
        after: ["If you don't answer by then, the request ends and the customer isn't charged."],
        button: { label: "Answer the request", url: providerUrl },
      });
    case "provider_new_booking":
      return render({
        recipient: "provider",
        subject: `New booking: ${l.title} on ${date}`,
        intro: [`${name} booked ${l.title}.`],
        facts: [["When", when], ["People", people(b.party_size)]],
        after: [`You'll receive ${money(b.provider_amount_cents)} after it happens.`],
        button: { label: "See the booking", url: providerUrl },
      });
    // Its own subject, saying what it means for the provider, the same case
    // as the first line (decided 2026-10-03; it had the customer's subject).
    case "provider_booking_cancelled": {
      const wasRequest = !b.confirmed_at;
      const on = date ? ` on ${date}` : "";
      const [subject, first] = b.cancelled_by === "customer"
        ? wasRequest
          ? [`Request withdrawn: ${l.title}`, `${name} withdrew their request for ${l.title}.`]
          : b.refunded_cents > 0
            ? [`Booking cancelled: ${l.title}${on}, no payout`, `${name} cancelled in time and was refunded, so there's no payout for this booking.`]
            : [`Booking cancelled: ${l.title}${on}, you'll still be paid`, `${name} cancelled less than 48 hours before. You'll still receive ${money(b.provider_amount_cents)} at payout.`]
        : b.reversal_failed_at
          ? [`Cancelled by lokl: ${l.title}${on}, payout owed back`, `lokl cancelled this booking and refunded the customer. We couldn't take back the ${money(b.provider_amount_cents)} we'd sent you for it, so you owe it to lokl. We'll be in touch about it.`]
          : b.stripe_transfer_reversal_id
            ? [`Cancelled by lokl: ${l.title}${on}, payout taken back`, `lokl cancelled this booking and refunded the customer. The ${money(b.provider_amount_cents)} we'd sent you for it has been taken back from your Stripe balance.`]
            : [`Cancelled by lokl: ${l.title}${on}, no payout`, "lokl cancelled this booking and refunded the customer."];
      return render({
        recipient: "provider",
        subject,
        intro: [first],
        button: { label: "See the booking", url: providerUrl },
      });
    }
    case "provider_request_unanswered":
      return render({
        recipient: "provider",
        subject: `Request ended: ${l.title}`,
        intro: [`You didn't answer ${name}'s request for ${l.title} in time, so it has ended. The customer wasn't charged.`],
        button: { label: "See the request", url: providerUrl },
      });
    case "provider_payout_sent":
      return render({
        recipient: "provider",
        subject: `Payout sent: ${money(b.provider_amount_cents)} for ${l.title}`,
        intro: [
          `We've sent ${money(b.provider_amount_cents)} for ${l.title}${date ? ` on ${date}` : ""} to your Stripe account. Stripe pays it into your bank on your usual payout schedule.`,
        ],
        button: { label: "See the booking", url: providerUrl },
      });
    case "provider_problem_reported":
      return render({
        recipient: "provider",
        subject: `A customer reported a problem: ${l.title}`,
        intro: [
          `${name} reported a problem with their booking for ${l.title}${date ? ` on ${date}` : ""}. Your payout for it is on hold while lokl looks into it. We'll be in touch by email.`,
        ],
        button: { label: "See the booking", url: providerUrl },
      });
    case "provider_payout_problem":
      return render({
        recipient: "provider",
        subject: `We couldn't send your payout for ${l.title}`,
        intro: [
          `We tried to send ${money(b.provider_amount_cents)} for ${l.title}, but your Stripe account can't receive it right now. Please check your payout settings. lokl will also be in touch.`,
        ],
        button: { label: "Check payout settings", url: `${c.siteUrl}/dashboard/payouts` },
      });

    // ------------------------------------------------------------ reviews
    // The same words for everyone, and nothing offered (docs/design/reviews.md:
    // no incentives). Never the review's own words.
    case "customer_review_request":
    case "customer_review_reminder": {
      const closes = b.ends_at ? dateOnly(new Date(Date.parse(b.ends_at) + 14 * 86_400_000).toISOString(), tz) : "";
      return render({
        recipient: "customer",
        subject: kind === "customer_review_request" ? `How was ${l.title}?` : `4 days left to review ${l.title}`,
        intro: [
          `Thanks for booking with ${provider.name}${date ? ` on ${date}` : ""}. If you have a minute, tell others what it was like: give it one to five stars and a few words.`,
        ],
        after: [
          `You can write it${closes ? ` until ${closes}` : " for 14 days after your booking"}. Reviews are public and show your first name and last initial.`,
        ],
        button: { label: "Write a review", url: `${customerUrl}#review` },
        link: { label: "Our review rules", url: `${c.siteUrl}/review-rules` },
      });
    }
    case "customer_review_removed": {
      const rule = c.review?.removedRule;
      return render({
        recipient: "customer",
        subject: `We removed your review of ${l.title}`,
        intro: [
          rule
            ? `We removed your review because it ${REVIEW_RULES[rule].title.toLowerCase()}: ${REVIEW_RULES[rule].text}`
            : "We removed your review because it broke one of our review rules.",
          "We remove a review only when it breaks one of our written rules, never for being negative. It can't be posted again for this booking.",
        ],
        button: { label: "See your booking", url: `${customerUrl}#review` },
        link: { label: "Our review rules", url: `${c.siteUrl}/review-rules` },
      });
    }
    case "provider_new_review": {
      const stars = c.review?.rating;
      return render({
        recipient: "provider",
        subject: `New review: ${l.title}`,
        intro: [
          `${name} reviewed their booking for ${l.title}${date ? ` on ${date}` : ""}${stars ? `, ${stars} out of 5 stars` : ""}.`,
          "You can post one public reply. Keep it about the booking, and don't offer anything in return for changing the review.",
        ],
        button: { label: "Read and reply", url: `${providerUrl}#review` },
      });
    }
    case "provider_reply_removed": {
      const rule = c.review?.replyRemovedRule;
      return render({
        recipient: "provider",
        subject: `We removed your reply: ${l.title}`,
        intro: [
          rule
            ? `We removed your reply to ${name}'s review because it ${REVIEW_RULES[rule].title.toLowerCase()}: ${REVIEW_RULES[rule].text}`
            : `We removed your reply to ${name}'s review because it broke one of our review rules.`,
          "You can delete it and write a new one on the booking page.",
        ],
        button: { label: "See the booking", url: `${providerUrl}#review` },
        link: { label: "Our review rules", url: `${c.siteUrl}/review-rules` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Provider account emails (provider_emails; decided 2026-10-03): paused when
// lokl suspends a provider, active again when it reinstates them. lokl's
// optional message is included only if written; the internal reason never
// is (it isn't even passed here).
// ---------------------------------------------------------------------------

export type ProviderAccountEmailKind = "provider_account_paused" | "provider_account_active" | "provider_profile_edited";

// What lokl removed from a profile, as the email lists it.
const REMOVED_LABELS: Record<string, string> = {
  avatar: "Your profile photo",
  cover: "Your cover photo",
  headline: "Your headline",
  bio: "The \"About you\" text",
};

export function renderProviderAccountEmail(
  kind: ProviderAccountEmailKind,
  c: { siteUrl: string; businessName: string; message: string | null; removed?: string[] | null; rule?: string | null },
): RenderedEmail {
  const message = c.message?.trim() || null;
  const button = { label: "Go to your dashboard", url: `${c.siteUrl}/dashboard` };
  // Profile content that broke a profile rule (docs/design/provider-profiles.md).
  if (kind === "provider_profile_edited") {
    const rule = c.rule && c.rule in PROFILE_RULES ? PROFILE_RULES[c.rule as ProfileRule] : null;
    return render({
      recipient: "account",
      subject: "We've removed part of your lokl profile",
      intro: [`We've removed this from the public profile for ${c.businessName}, because it doesn't follow lokl's profile rules:`],
      bullets: (c.removed ?? []).map((part) => REMOVED_LABELS[part] ?? part),
      after: [
        ...(rule ? [`The rule it didn't follow: ${rule}`] : []),
        "Your listings and bookings aren't affected. You can add new ones on your Business profile page.",
      ],
      message,
      button: { label: "Edit your profile", url: `${c.siteUrl}/dashboard/settings` },
    });
  }
  if (kind === "provider_account_paused") {
    return render({
      recipient: "account",
      subject: "Your lokl account is paused",
      intro: [`We've paused the lokl account for ${c.businessName}.`, "While it's paused:"],
      bullets: [
        "Your listings are hidden, so customers can't find or book them.",
        "Requests you hadn't answered, and bookings still in checkout, have been withdrawn. Those customers weren't charged.",
        "Your payouts are on hold.",
      ],
      after: [
        "Bookings that were already confirmed still go ahead, unless we tell you otherwise. If you can't do one, cancel it from your dashboard, and the customer gets a full refund.",
      ],
      message,
      button,
    });
  }
  return render({
    recipient: "account",
    subject: "Your lokl account is active again",
    intro: [`The lokl account for ${c.businessName} is active again. Your listings are back on lokl, and customers can book them.`],
    after: ["Payouts that were held while your account was paused stay on hold while we review them. We'll email you when each one is sent."],
    message,
    button,
  });
}
