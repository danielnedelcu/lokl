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
import { renderEmail, renderProviderAccountEmail, staleReviewEmail, type EmailContext, type EmailKind, type ProviderAccountEmailKind, type RenderedEmail } from "./bookingEmailTemplates";
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
}

/** Everything one email needs, read with the server key. */
export async function loadEmailContext(db: SupabaseClient, bookingId: string, siteUrl: string) {
  // From bookings, with the finances embedded (it joins the listing and
  // provider, which can't go through the private view).
  const { data: b, error } = await db
    .from("bookings")
    .select(
      "id, kind, status, starts_at, ends_at, confirmed_at, cancelled_at, problem_reported_at, problem_resolution, respond_by, preferred_times, party_size, total_cents, " +
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
      timezone: r.listing?.city?.timezone ?? "America/New_York",
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

type OutboxTable = "booking_emails" | "provider_emails";

async function finish(db: SupabaseClient, table: OutboxTable, id: string, update: Record<string, unknown>) {
  const { error } = await db.from(table).update({ ...update, locked_at: null }).eq("id", id);
  if (error) console.error("[emails] couldn't record the outcome", id, error.message);
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
    prepare: (row: R) => Promise<{ skip: string; to?: string | null } | { to: string | null; email: RenderedEmail }>;
  },
): Promise<SendResult> {
  const out: SendResult = { sent: [], skipped: [], retrying: [], failed: [] };
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

    for (const row of (data ?? []) as unknown as R[]) {
      // Over the quota: the rest would be refused too, so leave them for later.
      if (out.limited) break;
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
            const waited = Date.now() - Date.parse(row.created_at);
            if (waited >= QUOTA_GIVE_UP_MS) {
              await finish(db, o.table, row.id, { status: "failed", attempts: row.attempts, last_error: `Waited 48 hours for Resend's limits. ${message}`.slice(0, 500), to_address: to });
              out.failed.push(`${label}: waited 48 hours for Resend's limits`);
            } else {
              const next = new Date(Date.now() + (e.limit === "quota" ? QUOTA_RETRY_MS : RATE_RETRY_MS)).toISOString();
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
            const next = new Date(Date.now() + RETRY_MINUTES[attempts - 1]! * 60_000).toISOString();
            await finish(db, o.table, row.id, { status: "pending", next_attempt_at: next, last_error: message, to_address: to });
            out.retrying.push(`${label}: ${message}`);
          }
        }
      } catch (e) {
        // Couldn't even load or claim it: leave it for the next run.
        console.error("[emails]", label, e);
        out.retrying.push(`${label}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error("[emails] send run failed", e);
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
  opts: { bookingId?: string; now?: Date; limit?: number } = {},
): Promise<SendResult> {
  return runOutbox<Row>(db, mailer, settings, {
    table: "booking_emails",
    columns: "id, booking_id, kind, recipient, status, attempts, locked_at, created_at",
    keyPrefix: "booking-email",
    narrow: opts.bookingId ? (q) => q.eq("booking_id", opts.bookingId) : undefined,
    now: opts.now,
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

/** Sends the provider account emails that are due (paused, active again, profile content removed). Never throws. */
export async function sendProviderEmails(
  db: SupabaseClient,
  mailer: Mailer | null,
  settings: EmailSettings,
  opts: { providerId?: string; now?: Date; limit?: number } = {},
): Promise<SendResult> {
  type ProviderRow = OutboxRow & { provider_id: string; kind: ProviderAccountEmailKind; message: string | null; removed: string[] | null; rule: string | null };
  return runOutbox<ProviderRow>(db, mailer, settings, {
    table: "provider_emails",
    columns: "id, provider_id, kind, message, removed, rule, status, attempts, locked_at, created_at",
    keyPrefix: "provider-email",
    narrow: opts.providerId ? (q) => q.eq("provider_id", opts.providerId) : undefined,
    now: opts.now,
    limit: opts.limit,
    prepare: async (row) => {
      const { data: p, error } = await db.from("providers").select("display_name, owner_id").eq("id", row.provider_id).single();
      if (error) throw new Error(error.message);
      const to = await providerEmail(db, p.owner_id);
      return {
        to,
        email: renderProviderAccountEmail(row.kind, { siteUrl: settings.siteUrl, businessName: p.display_name, message: row.message, removed: row.removed, rule: row.rule }),
      };
    },
  });
}
