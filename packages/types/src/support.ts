import { z } from "zod";

// Problem reports (docs/design/problem-reports.md): their categories and
// statuses in words, shared by the provider's pages, the admin's board and
// the bell; the forms' rules (the routes check them again, and the database
// after them); and the limits' messages the database raises.

export const SUPPORT_CATEGORIES = ["booking", "payments", "listing", "website", "safety", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The category as the form offers it: "Payments and payouts". */
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  booking: "Bookings",
  payments: "Payments and payouts",
  listing: "My listing",
  website: "The website",
  safety: "Safety",
  other: "Something else",
};

/** The category inside a sentence: "your report about payments and payouts". */
export const SUPPORT_CATEGORY_ABOUT: Record<SupportCategory, string> = {
  booking: "a booking",
  payments: "payments and payouts",
  listing: "your listing",
  website: "the website",
  safety: "safety",
  other: "something else",
};

export const SUPPORT_STATUSES = ["todo", "in_progress", "waiting", "done"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** The words the database's rate limits raise (support_limit_message). */
export const SUPPORT_LIMIT_REPORTS = "You've sent a lot of reports today.";
export const SUPPORT_LIMIT_MESSAGES = "You've sent a lot of messages today.";

/** The status as the provider sees it, and the sentence that says what it means. */
export const SUPPORT_STATUS_FOR_PROVIDER: Record<SupportStatus, { label: string; sentence: string }> = {
  todo: { label: "Received", sentence: "We've got your report and will look at it soon." },
  in_progress: { label: "We're looking into it", sentence: "lokl is working on this." },
  waiting: { label: "Waiting for your reply", sentence: "lokl asked you something below. Reply when you can." },
  done: { label: "Resolved", sentence: "This is resolved. If it comes back, reply below." },
};

/** The status as the admin's board names its column. */
export const SUPPORT_STATUS_FOR_ADMIN: Record<SupportStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting on provider",
  done: "Done",
};

/** How long after it's resolved a reply still reopens a report. */
export const SUPPORT_REOPEN_DAYS = 30;

/** Can a reply still go on this report (resolved within the last 30 days, or not resolved)? */
export function supportCanReply(r: { status: SupportStatus; resolved_at: string | null }, now = Date.now()): boolean {
  return r.status !== "done" || !r.resolved_at || now - Date.parse(r.resolved_at) <= SUPPORT_REOPEN_DAYS * 864e5;
}

/** What the provider sends: "Report a problem". */
export const supportReportSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES, "Choose what it's about."),
  description: z.string("Tell us what happened.").trim()
    .min(20, "Tell us what happened, in at least 20 characters.")
    .max(5000, "Keep it under 5,000 characters."),
  listingId: z.uuid().nullish(),
  bookingId: z.uuid().nullish(),
  followsReportId: z.uuid().nullish(),
});
export type SupportReportInput = z.input<typeof supportReportSchema>;

/** lokl's reply, from the admin app ("Reply", or "Reply and wait for their answer"). */
export const supportAdminReplySchema = z.object({
  body: z.string("Write your reply.").trim().min(1, "Write your reply.").max(5000, "Keep it under 5,000 characters."),
  wait: z.boolean().default(false),
});

/** "Move to…": the column it goes to, and the one the admin saw it in. */
export const supportMoveSchema = z.object({
  to: z.enum(SUPPORT_STATUSES, "Choose a column."),
  from: z.enum(SUPPORT_STATUSES).nullish(),
});

/** An admin's private note. */
export const supportNoteSchema = z.object({
  body: z.string("Write the note.").trim().min(1, "Write the note.").max(5000, "Keep it under 5,000 characters."),
});

/** A reply on a report's thread. */
export const supportMessageSchema = z.object({
  body: z.string("Write your reply.").trim().min(1, "Write your reply.").max(5000, "Keep it under 5,000 characters."),
});

/**
 * A refusal as the page shows it: the limits' words get the 911 line and
 * the support address ("If anyone is in danger, call 911. You can also
 * email us at …").
 */
export function supportRefusalText(message: string, supportEmail?: string | null): string {
  if (message !== SUPPORT_LIMIT_REPORTS && message !== SUPPORT_LIMIT_MESSAGES) return message;
  return `${message} If anyone is in danger, call 911.${supportEmail ? ` You can also email us at ${supportEmail}.` : ""}`;
}

/** The admin bell's kinds: problem reports, team changes (adminTeamChangeText, for owners), and support's requests (adminRequestNewText, adminRequestDecidedText). */
export type AdminNotificationKind = "support_new" | "support_safety" | "support_reply" | "team_change" | "request_new" | "request_decided";

/** An admin bell item in words: "Urgent: a safety report from Fresh Cuts Studio." */
export function adminNotificationText(kind: "support_new" | "support_safety" | "support_reply", businessName: string, category: SupportCategory): string {
  if (kind === "support_safety") return `Urgent: a safety report from ${businessName}.`;
  if (kind === "support_new") return `${businessName} reported a problem about ${SUPPORT_CATEGORY_ABOUT[category]}.`;
  return `${businessName} replied to their report about ${SUPPORT_CATEGORY_ABOUT[category]}.`;
}
