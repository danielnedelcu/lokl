// Sends the booking emails the database queued (booking_emails, filled by
// triggers on bookings; docs/design/booking-and-checkout.md, Emails; step 4
// part 7). Safe to run any number of times, from anywhere:
//
// - A row is claimed (pending -> sending) before it's sent, so two senders
//   never both take it; a claim older than 10 minutes is taken over.
// - Resend gets the row's id as its idempotency key, so a send retried after
//   a timeout is dropped by Resend instead of delivered twice.
// - It never throws: each failure is recorded on its row and retried later
//   (1, 5, 15, 60, 240 minutes), then marked failed for the admin. So a
//   failed send can't break the booking action that queued it.
//
// Plain TypeScript with no Nuxt imports, like bookings.ts. The routes and
// jobs call it with the server key; supabase/tests/app/booking-emails.test.mts
// runs it with a fake mailer.

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminLimitReachedText, adminListingTakenDownText, adminProfileHiddenOverdueText, adminProfileHiddenText, adminRequestNewText, adminSettingsChangeText, adminSupportRefundText, adminTeamChangeText, errorText, marketZone, type AdminLimitName, type AdminRequestKind, type AdminTeamAction, type SupportCategory } from "@repo/types";
import { logText } from "@repo/types";
import { renderAdminInviteEmail, renderAdminJobAlertEmail, renderAdminLimitEmail, renderAdminListingTakenDownEmail, renderAdminProfileHiddenEmail, renderAdminProfileHiddenOverdueEmail, renderAdminRequestEmail, renderAdminSettingsChangeEmail, renderAdminSupportRefundEmail, renderAdminTeamChangeEmail, renderEmail, renderProviderAccountEmail, renderSupportEmail, staleReviewEmail, type EmailContext, type EmailKind, type ProviderAccountEmailKind, type RenderedEmail, type SupportEmailKind, type AdminEmailKind } from "./bookingEmailTemplates";
import { bookingRecords, FINANCES, withFinances } from "./bookingRecords";

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  from: string;
  replyTo: string;
  idempotencyKey: string;
}
export interface Mailer {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/** off: nothing is sent; allowlist: only to listed addresses (development); send: everyone. */
export type EmailMode = "off" | "allowlist" | "send";

export interface EmailSettings {
  mode: EmailMode;
  allowlist: string[];
  from: string;
  replyTo: string;
  siteUrl: string;
}

const RETRY_MINUTES = [1, 5, 15, 60, 240];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const STALE_CLAIM_MS = 10 * 60_000;

// Resend's account limits aren't the email's fault, so they don't count as
// attempts. Over the daily or monthly quota: try again every hour until it
// resets, giving up only once an email has waited 48 hours. Over the
// per-second rate: try again in a minute.
export const QUOTA_RETRY_MS = 60 * 60_000;
export const QUOTA_GIVE_UP_MS = 48 * 60 * 60_000;
const RATE_RETRY_MS = 60_000;

/** A send refused for an account limit (Resend's error name), not for the email itself. */
export class MailerLimitError extends Error {
  constructor(message: string, public limit: "quota" | "rate") {
    super(message);
  }
}

// Resend allows 10 requests a second per account. Sends from this process
// are spaced at least 150 ms apart (under 7 a second), so a burst (a whole
// session cancelled at once) doesn't get refused; a 429 that still happens
// is retried in a minute.
const MIN_GAP_MS = 150;
let nextSlot = 0;
async function waitForSlot() {
  // real time: spacing real requests to Resend.
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** Resend's API, called directly (it takes an idempotency key per send). */
export function resendMailer(apiKey: string): Mailer {
  return {
    async send(e) {
      await waitForSlot();
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": e.idempotencyKey },
        body: JSON.stringify({ from: e.from, to: [e.to], reply_to: e.replyTo, subject: e.subject, text: e.text, html: e.html }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      const message = `Resend ${res.status}: ${body.message ?? body.name ?? "no id returned"}`;
      if (body.name === "daily_quota_exceeded" || body.name === "monthly_quota_exceeded") throw new MailerLimitError(message, "quota");
      if (res.status === 429) throw new MailerLimitError(message, "rate");
      if (!res.ok || !body.id) throw new Error(message);
      return { id: body.id };
    },
  };
}

/** Reads the settings from the website's runtime config values. */
export function emailSettings(c: { emailMode?: string; emailAllowlist?: string; emailFrom?: string; emailReplyTo?: string; resendApiKey?: string }, siteUrl: string): EmailSettings {
  const mode = (["off", "allowlist", "send"].includes(c.emailMode ?? "") ? c.emailMode : "off") as EmailMode;
  return {
    mode: c.resendApiKey ? mode : "off",
    allowlist: (c.emailAllowlist ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
    from: c.emailFrom || "lokl <lokl@innatetheory.com>",
    replyTo: (c.emailReplyTo ?? "").trim(),
    siteUrl,
  };
}

interface Row {
  id: string;
  booking_id: string;
  kind: EmailKind;
  recipient: "customer" | "provider";
  status: string;
  attempts: number;
  locked_at: string | null;
  created_at: string;
}

export interface SendResult {
  sent: string[];
  skipped: string[];
  retrying: string[];
  failed: string[];
  /** Resend refused for the account's quota, so the run stopped early. */
  limited?: boolean;
  /** The batch was full, so more emails may be waiting for the next run. */
  more: boolean;
}

/** Everything one email needs, read with the server key. */
export async function loadEmailContext(db: SupabaseClient, bookingId: string, siteUrl: string) {
  // From bookings, with the finances embedded (it joins the listing and
  // provider, which can't go through the private view).
  const { data: b, error } = await db
    .from("bookings")
    .select(
      "id, kind, status, service_mode, starts_at, ends_at, confirmed_at, cancelled_at, problem_reported_at, problem_resolution, respond_by, party_size, total_cents, " +
      "refunded_cents, cancelled_by, status_changed_by, customer_name, customer_id, provider_id, " +
      // The booking's review, for the review emails (docs/design/reviews.md).
      "review:reviews(rating, status, removed_rule, reply:review_replies(status, removed_rule)), " +
      `${FINANCES}, ` +
      "contact:booking_contacts(email), " +
      "listing:listings(title, kind, category:categories(slug), city:cities(name, slug, timezone)), " +
      "provider:providers(display_name, owner_id)",
    )
    .eq("id", bookingId)
    .single();
  if (error) throw new Error(error.message);
  const r = withFinances(b as any);
  const ctx: EmailContext = {
    siteUrl,
    booking: r,
    listing: {
      title: r.listing?.title ?? "your booking",
      kind: r.listing?.kind ?? r.kind,
      categorySlug: r.listing?.category?.slug ?? null,
      marketSlug: r.listing?.city?.slug ?? "atlanta",
      marketName: r.listing?.city?.name ?? "Atlanta",
      timezone: marketZone(r.listing?.city, `booking ${bookingId}`),
    },
    provider: { name: r.provider?.display_name ?? "The provider" },
    review: reviewOf(r.review),
  };
  return { ctx, customerEmail: (r.contact?.email as string | undefined) ?? null, providerOwnerId: r.provider?.owner_id as string | undefined, status: r.status as string };
}

function reviewOf(raw: any): EmailContext["review"] {
  const r = Array.isArray(raw) ? raw[0] : raw;
  if (!r) return null;
  const reply = Array.isArray(r.reply) ? r.reply[0] : r.reply;
  return { rating: r.rating, status: r.status, removedRule: r.removed_rule ?? null, replyStatus: reply?.status ?? null, replyRemovedRule: reply?.removed_rule ?? null };
}

// The provider's address: their sign-in email (decided 2026-10-02).
async function providerEmail(db: SupabaseClient, ownerId: string | undefined) {
  if (!ownerId) return null;
  const { data, error } = await db.auth.admin.getUserById(ownerId);
  if (error) throw new Error(error.message);
  return data.user?.email ?? null;
}

type OutboxTable = "booking_emails" | "provider_emails" | "support_emails" | "admin_emails";

async function finish(db: SupabaseClient, table: OutboxTable, id: string, update: Record<string, unknown>) {
  // Resend's messages can quote an address; the row keeps only its id.
  if (typeof update.last_error === "string") update = { ...update, last_error: logText(update.last_error, 500) };
  const { error } = await db.from(table).update({ ...update, locked_at: null }).eq("id", id);
  if (error) console.error("[emails] couldn't record the outcome", id, errorText(error));
}

interface OutboxRow { id: string; kind: string; status: string; attempts: number; locked_at: string | null; created_at: string }

/**
 * The one outbox runner, for booking_emails and provider_emails: picks what's
 * due, claims each row, asks `prepare` for the email (or a reason to skip),
 * sends it with the row id as the idempotency key, and records the outcome,
 * with the retries and Resend-limit handling described at the top. Never
 * throws.
 */
async function runOutbox<R extends OutboxRow>(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  o: {
    table: OutboxTable;
    columns: string;
    keyPrefix: string;
    narrow?: (q: any) => any;
    now?: Date;
    limit?: number;
    /** Stop claiming rows after this time (ms since the epoch): a scheduled run's budget. */
    deadline?: number;
    prepare: (row: R) => Promise<{ skip: string; to?: string | null } | { to: string | null; email: RenderedEmail }>;
  },
): Promise<SendResult> {
  const out: SendResult = { sent: [], skipped: [], retrying: [], failed: [], more: false };
  try {
    const now = o.now ?? new Date();
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
    // Due: a new email (never failed) at once; a retry once its time has
    // come; a send stuck part-way after 10 minutes. A new row's
    // next_attempt_at is the database's clock, which can run ahead of this
    // server's: comparing the two left a fresh email "not due yet" for a few
    // milliseconds, which is exactly when a route sends straight after its
    // change, so it waited for the next job (found 2026-10-02). Only times
    // this server wrote itself (retry times, claims) are compared here.
    let q = db
      .from(o.table)
      .select(o.columns)
      .or(`and(status.eq.pending,last_error.is.null),and(status.eq.pending,next_attempt_at.lte.${now.toISOString()}),and(status.eq.sending,locked_at.lt.${staleBefore})`)
      .order("created_at")
      .limit(o.limit ?? 50);
    if (o.narrow) q = o.narrow(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.more = (data?.length ?? 0) >= (o.limit ?? 50);

    for (const row of (data ?? []) as unknown as R[]) {
      // Over the quota: the rest would be refused too, so leave them for later.
      if (out.limited) break;
      // real time: the run's budget, against the host's own clock.
      if (o.deadline && Date.now() > o.deadline) {
        out.more = true;
        break;
      }
      const label = `${row.id} ${row.kind}`;
      try {
        // A send that keeps crashing mid-way doesn't get retried forever.
        if (row.status === "sending" && row.attempts >= MAX_ATTEMPTS) {
          await finish(db, o.table, row.id, { status: "failed", last_error: "Stopped part-way too many times." });
          out.failed.push(`${label}: stopped part-way too many times`);
          continue;
        }
        // Claim it: only from the state read, so two senders can't both win.
        let claim = db.from(o.table)
          .update({ status: "sending", locked_at: now.toISOString(), attempts: row.attempts + 1 })
          .eq("id", row.id).eq("status", row.status).eq("attempts", row.attempts);
        claim = row.locked_at ? claim.eq("locked_at", row.locked_at) : claim.is("locked_at", null);
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) throw new Error(claimError.message);
        if (!claimed?.length) continue;

        const prepared = await o.prepare(row);
        if ("skip" in prepared) {
          await finish(db, o.table, row.id, { status: "skipped", skip_reason: prepared.skip, to_address: prepared.to ?? null });
          out.skipped.push(`${label}: ${prepared.skip}`);
          continue;
        }
        const to = prepared.to;
        const skip = !to ? "No address for the recipient."
          : settings.mode === "off" ? "Email sending is off."
          : !settings.replyTo ? "NUXT_EMAIL_REPLY_TO isn't set."
          : settings.mode === "allowlist" && !settings.allowlist.includes(to.toLowerCase()) ? "Not on the development allowlist."
          : !mailer ? "No mailer configured."
          : null;
        if (skip) {
          await finish(db, o.table, row.id, { status: "skipped", skip_reason: skip, to_address: to });
          out.skipped.push(`${label}: ${skip}`);
          continue;
        }

        try {
          const { id } = await mailer!.send({ ...prepared.email, to: to!, from: settings.from, replyTo: settings.replyTo, idempotencyKey: `${o.keyPrefix}-${row.id}` });
          // real time: when it was really sent (a record).
          await finish(db, o.table, row.id, { status: "sent", sent_at: new Date().toISOString(), resend_id: id, to_address: to, last_error: null });
          out.sent.push(`${label}: sent`);
        } catch (e) {
          const attempts = row.attempts + 1;
          const message = (e as Error).message.slice(0, 500);
          if (e instanceof MailerLimitError) {
            // Not the email's fault: the attempt doesn't count. A quota stops
            // this run; an email waiting 48 hours on a limit is given up on.
            // (Either limit: if Resend names a quota error differently, it's
            // still retried as a rate limit and still given up on in time.)
            const waited = now.getTime() - Date.parse(row.created_at);
            if (waited >= QUOTA_GIVE_UP_MS) {
              await finish(db, o.table, row.id, { status: "failed", attempts: row.attempts, last_error: `Waited 48 hours for Resend's limits. ${message}`.slice(0, 500), to_address: to });
              out.failed.push(`${label}: waited 48 hours for Resend's limits`);
            } else {
              const next = new Date(now.getTime() + (e.limit === "quota" ? QUOTA_RETRY_MS : RATE_RETRY_MS)).toISOString();
              await finish(db, o.table, row.id, { status: "pending", attempts: row.attempts, next_attempt_at: next, last_error: message, to_address: to });
              out.retrying.push(`${label}: ${message}`);
            }
            if (e.limit === "quota") out.limited = true;
            continue;
          }
          if (attempts >= MAX_ATTEMPTS) {
            await finish(db, o.table, row.id, { status: "failed", last_error: message, to_address: to });
            out.failed.push(`${label}: ${message}`);
          } else {
            const next = new Date(now.getTime() + RETRY_MINUTES[attempts - 1]! * 60_000).toISOString();
            await finish(db, o.table, row.id, { status: "pending", next_attempt_at: next, last_error: message, to_address: to });
            out.retrying.push(`${label}: ${message}`);
          }
        }
      } catch (e) {
        // Couldn't even load or claim it: leave it for the next run.
        console.error("[emails]", label, errorText(e));
        out.retrying.push(`${label}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error("[emails] send run failed", errorText(e));
  }
  return out;
}

/**
 * Sends the booking emails that are due (optionally for one booking). Never
 * throws; returns what it did, one "<email id> <kind>: <outcome>" line each.
 */
export async function sendBookingEmails(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  opts: { bookingId?: string; now?: Date; limit?: number; deadline?: number } = {},
): Promise<SendResult> {
  return runOutbox<Row>(db, mailer, settings, {
    table: "booking_emails",
    columns: "id, booking_id, kind, recipient, status, attempts, locked_at, created_at",
    keyPrefix: "booking-email",
    narrow: opts.bookingId ? (q) => q.eq("booking_id", opts.bookingId) : undefined,
    now: opts.now,
    deadline: opts.deadline,
    limit: opts.limit,
    prepare: async (row) => {
      const { ctx, customerEmail, providerOwnerId, status } = await loadEmailContext(db, row.booking_id, settings.siteUrl);
      // Out of date: the request was answered before this went out.
      if ((row.kind === "customer_request_sent" || row.kind === "provider_new_request") && status !== "requested") {
        return { skip: "The request was already answered." };
      }
      const stale = staleReviewEmail(row.kind, ctx);
      if (stale) return { skip: stale };
      const to = row.recipient === "customer" ? customerEmail : await providerEmail(db, providerOwnerId);
      return { to, email: renderEmail(row.kind, ctx) };
    },
  });
}

/** Sends the provider account emails that are due (paused, active again, profile content hidden, removed, restored or reviewed). Never throws. */
export async function sendProviderEmails(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  opts: { providerId?: string; now?: Date; limit?: number; deadline?: number } = {},
): Promise<SendResult> {
  type ProviderRow = OutboxRow & { provider_id: string; admin_action_id: string; kind: ProviderAccountEmailKind; message: string | null; removed: string[] | null; rule: string | null };
  return runOutbox<ProviderRow>(db, mailer, settings, {
    table: "provider_emails",
    columns: "id, provider_id, admin_action_id, kind, message, removed, rule, status, attempts, locked_at, created_at",
    keyPrefix: "provider-email",
    narrow: opts.providerId ? (q) => q.eq("provider_id", opts.providerId) : undefined,
    now: opts.now,
    deadline: opts.deadline,
    limit: opts.limit,
    prepare: async (row) => {
      const { data: p, error } = await db.from("providers").select("display_name, owner_id").eq("id", row.provider_id).single();
      if (error) throw new Error(error.message);
      const to = await providerEmail(db, p.owner_id);
      // "Hidden while lokl reviews it" is stale once every part it names
      // has been decided (its decision's own email says what happened).
      if (row.kind === "provider_profile_hidden") {
        // bounded: one hide's holds, at most four parts
        const { data: open } = await db.from("provider_profile_holds").select("id").eq("hidden_action_id", row.admin_action_id).eq("status", "hidden");
        if (!open?.length) return { skip: "Already decided: the decision's email says what happened.", to };
      }
      return {
        to,
        email: renderProviderAccountEmail(row.kind, { siteUrl: settings.siteUrl, businessName: p.display_name, message: row.message, removed: row.removed, rule: row.rule }),
      };
    },
  });
}

/**
 * Sends the problem reports' emails that are due (docs/design/problem-reports.md):
 * lokl's reply to the provider's owner, and a new report or a reply to each
 * admin login (skipped if it's no longer an admin). Never the message text.
 * Never throws.
 */
export async function sendSupportEmails(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  opts: { adminUrl: string; reportId?: string; now?: Date; limit?: number; deadline?: number },
): Promise<SendResult> {
  type SupportRow = OutboxRow & { report_id: string; kind: SupportEmailKind; provider_id: string | null; admin_id: string | null };
  return runOutbox<SupportRow>(db, mailer, settings, {
    table: "support_emails",
    columns: "id, report_id, kind, provider_id, admin_id, status, attempts, locked_at, created_at",
    keyPrefix: "support-email",
    narrow: opts.reportId ? (q) => q.eq("report_id", opts.reportId) : undefined,
    now: opts.now,
    deadline: opts.deadline,
    limit: opts.limit,
    prepare: async (row) => {
      const { data: r, error } = await db.from("support_reports")
        .select("id, category, provider:providers(display_name, owner_id)").eq("id", row.report_id).single();
      if (error) throw new Error(error.message);
      const report = r as unknown as { id: string; category: SupportCategory; provider: { display_name: string; owner_id: string } };
      let to: string | null;
      if (row.kind === "provider_support_reply") {
        to = await providerEmail(db, report.provider.owner_id);
      } else {
        if (!row.admin_id) return { skip: "No admin named." };
        if (!opts.adminUrl) return { skip: "NUXT_ADMIN_ORIGIN isn't set, so there's no link to the report." };
        const { data: u, error: userError } = await db.auth.admin.getUserById(row.admin_id);
        if (userError || !u.user) return { skip: "That admin login no longer exists." };
        // Still on the team (admin_members, live; docs/design/admin-roles.md).
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("status").eq("user_id", row.admin_id).maybeSingle();
        if (member?.status !== "active") return { skip: "No longer an admin." };
        to = u.user.email ?? null;
      }
      return {
        to,
        email: renderSupportEmail(row.kind, {
          siteUrl: settings.siteUrl, adminUrl: opts.adminUrl.replace(/\/$/, ""), reportId: report.id,
          businessName: report.provider.display_name, category: report.category,
        }),
      };
    },
  });
}

/**
 * Sends the team's emails that are due (admin roles, steps 5a and 5b): an
 * invitation to the person invited (skipped once they're no longer
 * invited), each team change to each owner (skipped if they're no longer an
 * active owner), and each support request to each owner (skipped once it's
 * decided). Never the reason. Never throws.
 */
export async function sendAdminEmails(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  opts: { adminUrl: string; now?: Date; limit?: number; deadline?: number },
): Promise<SendResult> {
  type AdminRow = OutboxRow & { kind: AdminEmailKind; admin_action_id: string | null; job_alert_id: string | null; recipient_id: string };
  const emailOf = async (id: string) => {
    const { data, error } = await db.auth.admin.getUserById(id);
    return error ? null : (data.user?.email ?? null);
  };
  return runOutbox<AdminRow>(db, mailer, settings, {
    table: "admin_emails",
    columns: "id, kind, admin_action_id, job_alert_id, recipient_id, status, attempts, locked_at, created_at",
    keyPrefix: "admin-email",
    now: opts.now,
    deadline: opts.deadline,
    limit: opts.limit,
    prepare: async (row) => {
      if (!opts.adminUrl) return { skip: "NUXT_ADMIN_ORIGIN isn't set, so there's no link to the admin app." };
      const adminUrl = opts.adminUrl.replace(/\/$/, "");
      // A job alert (the watchdog, which also emails the owners itself,
      // straight through Resend): this copy goes unless that one was delivered.
      if (row.kind === "admin_job_alert") {
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const { data: delivery, error: dError } = await db.rpc("job_alert_delivery", { p_alert: row.job_alert_id! });
        if (dError) throw new Error(dError.message);
        if (delivery === "sent") return { skip: "Already emailed by the watchdog itself.", to };
        // No answer from Resend yet: try this copy again in a minute.
        if (delivery === "pending") throw new Error("waiting for the watchdog's own email to be answered");
        const { data: alert, error: aError } = await db.from("job_alerts").select("kind, message").eq("id", row.job_alert_id!).single();
        if (aError) throw new Error(aError.message);
        return { to, email: renderAdminJobAlertEmail({ adminUrl, text: alert.message, recovered: alert.kind === "recovered" }) };
      }
      const { data: action, error } = await db.from("admin_actions")
        .select("admin_id, target_id, action, message, amount_cents").eq("id", row.admin_action_id!).single();
      if (error) throw new Error(error.message);
      if (row.kind === "admin_profile_hidden_overdue") {
        // For each owner, once per hide (the hidden-content-reminder job); skipped once it's decided.
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const [{ data: p }, { data: holds }] = await Promise.all([
          db.from("providers").select("display_name").eq("id", action.target_id!).maybeSingle(),
          // bounded: one hide's holds, at most four parts
          db.from("provider_profile_holds").select("part").eq("hidden_action_id", row.admin_action_id!).eq("status", "hidden"),
        ]);
        const parts = ((holds ?? []) as { part: string }[]).map((h) => h.part);
        if (!parts.length) return { skip: "Already decided.", to };
        return { to, email: renderAdminProfileHiddenOverdueEmail({ adminUrl, text: adminProfileHiddenOverdueText(p?.display_name, parts) }) };
      }
      if (row.kind === "admin_profile_hidden") {
        // For each owner (step 5e); skipped once they're no longer one.
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const who = (await emailOf(action.admin_id)) ?? "A support member";
        const [{ data: p }, { data: holds }] = await Promise.all([
          db.from("providers").select("display_name").eq("id", action.target_id).maybeSingle(),
          // bounded: one hide's holds, at most four parts
          db.from("provider_profile_holds").select("part").eq("hidden_action_id", row.admin_action_id),
        ]);
        const parts = ((holds ?? []) as { part: string }[]).map((h) => h.part);
        return { to, email: renderAdminProfileHiddenEmail({ adminUrl, text: adminProfileHiddenText(who, p?.display_name, parts) }) };
      }
      if (row.kind === "admin_listing_taken_down" || row.kind === "admin_settings_change") {
        // For each owner (step 5d); skipped once they're no longer one.
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const who = (await emailOf(action.admin_id)) ?? "Someone on the team";
        if (row.kind === "admin_settings_change") {
          return { to, email: renderAdminSettingsChangeEmail({ adminUrl, text: adminSettingsChangeText(who, action.message) }) };
        }
        const { data: l } = await db.from("listings").select("title").eq("id", action.target_id).maybeSingle();
        return { to, email: renderAdminListingTakenDownEmail({ adminUrl, text: adminListingTakenDownText(who, l?.title), listingId: action.target_id }) };
      }
      if (row.kind === "admin_limit_reached" || row.kind === "admin_support_refund") {
        // For each owner; skipped once they're no longer one (step 5c).
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const who = (await emailOf(action.admin_id)) ?? "A support member";
        if (row.kind === "admin_limit_reached") {
          return { to, email: renderAdminLimitEmail({ adminUrl, text: adminLimitReachedText(who, action.message as AdminLimitName) }) };
        }
        const { data: b } = await db.from("bookings").select("listing:listings(title), provider:providers(display_name)").eq("id", action.target_id).maybeSingle();
        const booking = b as unknown as { listing: { title: string } | null; provider: { display_name: string } | null } | null;
        const text = adminSupportRefundText(who, {
          amountCents: action.amount_cents, resolvedReport: action.action === "resolve_problem_refunded",
          listingTitle: booking?.listing?.title, providerName: booking?.provider?.display_name,
        });
        return { to, email: renderAdminSupportRefundEmail({ adminUrl, text, bookingId: action.target_id }) };
      }
      if (row.kind === "admin_request_new") {
        // A support member's request, for each owner; skipped once it's decided.
        // bounded: one row by its primary key
        const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
        const to = await emailOf(row.recipient_id);
        if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
        const { data: r, error: rError } = await db.from("admin_requests")
          .select("kind, status, resolve_problem, amount_cents, booking:bookings(listing:listings(title), provider:providers(display_name)), provider:providers!admin_requests_provider_id_fkey(display_name)")
          .eq("id", action.target_id).single();
        if (rError) throw new Error(rError.message);
        const req = r as unknown as {
          kind: AdminRequestKind; status: string; resolve_problem: boolean; amount_cents: number | null;
          booking: { listing: { title: string } | null; provider: { display_name: string } | null } | null;
          provider: { display_name: string } | null;
        };
        if (req.status !== "pending") return { skip: "Already decided.", to };
        const who = (await emailOf(action.admin_id)) ?? "A support member";
        const text = adminRequestNewText(who, {
          kind: req.kind, resolveProblem: req.resolve_problem, amountCents: req.amount_cents,
          listingTitle: req.booking?.listing?.title, providerName: req.booking?.provider?.display_name ?? req.provider?.display_name,
        });
        return { to, email: renderAdminRequestEmail({ adminUrl, text }) };
      }
      // bounded: one row by its primary key
      const { data: member } = await db.from("admin_members").select("role, status").eq("user_id", row.recipient_id).maybeSingle();
      const to = await emailOf(row.recipient_id);
      const who = (await emailOf(action.admin_id)) ?? "An owner";
      if (row.kind === "admin_invite") {
        if (member?.status !== "invited") return { skip: "No longer invited.", to };
        return { to, email: renderAdminInviteEmail({ adminUrl, invitedBy: who, role: action.message ?? "" }) };
      }
      if (member?.status !== "active" || member.role !== "owner") return { skip: "No longer an owner.", to };
      const whom = (await emailOf(action.target_id)) ?? "a team member";
      const text = adminTeamChangeText(action.action as AdminTeamAction, who, whom, action.message);
      return { to, email: renderAdminTeamChangeEmail({ adminUrl, text }) };
    },
  });
}
