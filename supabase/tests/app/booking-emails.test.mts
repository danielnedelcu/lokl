// Sending the booking emails (apps/website/server/utils/bookingEmails.ts)
// against the LOCAL stack, with a fake mailer that records what it's asked
// to send: each email once, the same idempotency key on a retry, failures
// recorded and retried without touching the booking, two senders never
// both sending, and the development allowlist. No real email is sent.
// Run: npx tsx supabase/tests/app/booking-emails.test.mts

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MailerLimitError, MAX_ATTEMPTS, QUOTA_RETRY_MS, sendBookingEmails, type EmailSettings, type Mailer, type OutgoingEmail } from "../../../apps/website/server/utils/bookingEmails";

const local = Object.fromEntries(execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(local.API_URL ?? "")) {
  console.error("Refusing to run: needs the local stack (`npx supabase start`).");
  process.exit(1);
}
const db = createClient(local.API_URL!, local.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const run = randomBytes(4).toString("hex");
let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
// A fake mailer: records every send; can be told to fail, or to be slow.
function fakeMailer() {
  const sent: OutgoingEmail[] = [];
  let failNext = 0;
  let delay = 0;
  let limitNext = 0;
  let limitKind: "quota" | "rate" = "quota";
  const m: Mailer & { sent: OutgoingEmail[]; calls: number; failTimes(n: number): void; slow(ms: number): void; limitTimes(n: number, kind: "quota" | "rate"): void } = {
    sent,
    calls: 0,
    failTimes(n) { failNext = n; },
    slow(ms) { delay = ms; },
    // As Resend answers when the team is over its quota (or the per-second rate).
    limitTimes(n, kind) { limitNext = n; limitKind = kind; },
    async send(e) {
      m.calls++;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (limitNext > 0) {
        limitNext--;
        throw new MailerLimitError(limitKind === "quota" ? "Resend 429: You have reached your daily email sending quota." : "Resend 429: Too many requests.", limitKind);
      }
      if (failNext > 0) { failNext--; throw new Error("Resend 500: test failure"); }
      sent.push(e);
      return { id: `re_test_${sent.length}` };
    },
  };
  return m;
}
const emailsFor = async (bookingId: string) =>
  (await must(db.from("booking_emails").select("*").eq("booking_id", bookingId).order("kind"))) as Record<string, any>[];
const created = { users: [] as string[], provider: "", listings: [] as string[], categories: [] as string[], area: "" };
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

try {
  const atl = await must(db.from("cities").select("id").eq("slug", "atlanta").single());
  const user = async (label: string) => {
    const { user: u } = await must(db.auth.admin.createUser({ email: `emails-${label}-${run}@test.local`, email_confirm: true }));
    created.users.push(u.id);
    return { id: u.id, email: u.email! };
  };
  const owner = await user("provider");
  const customer = await user("customer");
  created.provider = (await must(db.from("providers").insert({ owner_id: owner.id, display_name: "Emails Test", city_id: atl.id }).select("id").single())).id;
  const cat = (await must(db.from("categories").insert({ kind: "service", name: `Emails ${run}`, slug: `emails-${run}` }).select("id").single())).id;
  created.categories.push(cat);
  created.area = (await must(db.from("service_areas").insert({ city_id: atl.id, kind: "neighborhood", name: `Emails ${run}` }).select("id").single())).id;
  const listingId = randomUUID();
  created.listings.push(listingId);
  await must(db.from("listings").insert({
    id: listingId, provider_id: created.provider, city_id: atl.id, area_id: created.area, status: "submitted", kind: "service",
    category_id: cat, title: `Emails cut ${run}`, description: "A Service made by the booking emails test.", price_cents: 4500,
    duration_minutes: 60, location_mode: "provider_location",
  }));
  await must(db.from("listing_photos").insert({ listing_id: listingId, storage_path: `${created.provider}/${listingId}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
  await must(db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", listingId));
  const request = async () => {
    const b = await must(db.rpc("create_service_request", {
      p_listing_id: listingId, p_customer_id: customer.id, p_preferred_times: [new Date(Date.now() + 3 * 864e5).toISOString()],
      p_customer_name: "Sam Customer", p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    await must(db.from("bookings").update({ status: "requested", status_changed_by: "stripe", respond_by: new Date(Date.now() + 2 * 864e5).toISOString() }).eq("id", b.id));
    return b.id;
  };
  const settings = (over: Partial<EmailSettings> = {}): EmailSettings => ({
    mode: "allowlist", allowlist: [customer.email, owner.email], from: "lokl <lokl@innatetheory.com>",
    replyTo: "replies@example.com", siteUrl: "http://localhost:3100", ...over,
  });

  // 1. A request queues two emails; the sender sends each once, to the right people.
  const a = await request();
  const m1 = fakeMailer();
  const r1 = await sendBookingEmails(db, m1, settings(), { bookingId: a });
  const to = m1.sent.map((e) => e.to).sort();
  check(r1.sent.length === 2 && to.join() === [customer.email, owner.email].sort().join(), "1a. the request emails go to the customer and the provider's sign-in address");
  check(m1.sent.every((e) => e.replyTo === "replies@example.com" && e.from.includes("lokl@innatetheory.com")), "1b. ...from lokl, with the reply-to address");
  const rows = await emailsFor(a);
  check(rows.every((r) => r.status === "sent" && r.resend_id?.startsWith("re_test_") && r.sent_at), "1c. each is recorded as sent, with Resend's id");
  check(m1.sent.every((e, i) => e.idempotencyKey === `booking-email-${rows.find((r) => r.resend_id === `re_test_${i + 1}`)?.id}`), "1d. each send carries its row's idempotency key");
  await sendBookingEmails(db, m1, settings(), { bookingId: a });
  check(m1.sent.length === 2, "1e. running the sender again sends nothing more");

  // 2. A failed send: recorded, retried later with the same key, the booking untouched.
  await must(db.from("bookings").update({ status: "confirmed", starts_at: (await must(db.from("bookings").select("preferred_times").eq("id", a).single())).preferred_times[0], status_changed_by: "provider" }).eq("id", a));
  check((await must(db.from("bookings").select("status").eq("id", a).single())).status === "confirmed", "2a. accepting works whatever happens to its email");
  const m2 = fakeMailer();
  m2.failTimes(1);
  const r2 = await sendBookingEmails(db, m2, settings(), { bookingId: a });
  const accepted = (await emailsFor(a)).find((r) => r.kind === "customer_request_accepted")!;
  check(r2.retrying.length === 1 && accepted.status === "pending" && accepted.attempts === 1 && accepted.last_error?.includes("test failure"),
    "2b. a failed send is recorded and left to retry");
  check(Date.parse(accepted.next_attempt_at) > Date.now(), "2c. ...not straight away");
  await sendBookingEmails(db, m2, settings(), { bookingId: a });
  check(m2.sent.length === 0, "2d. ...and not before its retry time");
  await sendBookingEmails(db, m2, settings(), { bookingId: a, now: later(2) });
  check(m2.sent.length === 1 && m2.sent[0]!.idempotencyKey === `booking-email-${accepted.id}`, "2e. the retry sends it, with the same idempotency key");

  // 3. Failing every time: given up on after the limit, for the admin.
  const b = await request();
  const m3 = fakeMailer();
  m3.failTimes(100);
  for (let i = 0, t = 0; i < MAX_ATTEMPTS; i++, t += 300) await sendBookingEmails(db, m3, settings(), { bookingId: b, now: later(t) });
  const gaveUp = await emailsFor(b);
  check(gaveUp.every((r) => r.status === "failed" && r.attempts === MAX_ATTEMPTS), `3. after ${MAX_ATTEMPTS} failed tries, an email is marked failed`);

  // 4. Two senders at once send each email once.
  const c = await request();
  const m4 = fakeMailer();
  m4.slow(300);
  await Promise.all([sendBookingEmails(db, m4, settings(), { bookingId: c }), sendBookingEmails(db, m4, settings(), { bookingId: c })]);
  check(m4.sent.length === 2, `4. two senders running together still send each email once (${m4.sent.length} sent)`);

  // 5. Skips: off, not on the allowlist, no reply-to, out of date.
  const d = await request();
  await sendBookingEmails(db, fakeMailer(), settings({ allowlist: [owner.email] }), { bookingId: d });
  const dRows = await emailsFor(d);
  check(dRows.find((r) => r.recipient === "customer")!.status === "skipped" && dRows.find((r) => r.recipient === "provider")!.status === "sent",
    "5a. in allowlist mode, an address not on the list is skipped");
  const e = await request();
  const m5 = fakeMailer();
  await sendBookingEmails(db, m5, settings({ mode: "off" }), { bookingId: e });
  check(m5.sent.length === 0 && (await emailsFor(e)).every((r) => r.status === "skipped" && r.skip_reason === "Email sending is off."), "5b. with sending off, nothing is sent");
  const f = await request();
  await sendBookingEmails(db, fakeMailer(), settings({ replyTo: "" }), { bookingId: f });
  check((await emailsFor(f)).every((r) => r.skip_reason === "NUXT_EMAIL_REPLY_TO isn't set."), "5c. without a reply-to address, nothing is sent");
  const g = await request();
  await must(db.from("bookings").update({ status: "declined", status_changed_by: "provider" }).eq("id", g));
  const m6 = fakeMailer();
  await sendBookingEmails(db, m6, settings(), { bookingId: g });
  const gRows = await emailsFor(g);
  check(gRows.find((r) => r.kind === "customer_request_sent")!.status === "skipped" && m6.sent.length === 1 && m6.sent[0]!.subject.startsWith("Not available"),
    "5d. a request answered before its emails went out skips them, and sends only the answer");

  // 7. A brand-new email goes out at once even when the database's clock is
  // ahead of the server's (it was 40 ms ahead on 2026-10-02, and the accept
  // route's email waited for the next job).
  const h = await request();
  await must(db.from("booking_emails").update({ next_attempt_at: new Date(Date.now() + 5_000).toISOString() }).eq("booking_id", h));
  const m7 = fakeMailer();
  await sendBookingEmails(db, m7, settings(), { bookingId: h });
  check(m7.sent.length === 2, `7a. new emails are sent straight away, whatever the clocks say (${m7.sent.length} of 2)`);
  const i = await request();
  const m8 = fakeMailer();
  m8.failTimes(1);
  await sendBookingEmails(db, m8, settings(), { bookingId: i });
  await sendBookingEmails(db, m8, settings(), { bookingId: i });
  check(m8.sent.length === 1, "7b. ...while a retry still waits for its retry time");

  // 8. Over Resend's daily quota: retried after the quota resets, never
  // counted as a failed attempt, and the rest of the run waits too.
  const q = await request();
  const mq = fakeMailer();
  mq.limitTimes(1, "quota");
  const rq = await sendBookingEmails(db, mq, settings(), { bookingId: q });
  const qRows = await emailsFor(q);
  const refused = qRows.find((r) => r.last_error)!;
  check(rq.limited === true && mq.calls === 1, "8a. the first quota refusal stops the run, without trying the other email");
  check(refused.status === "pending" && refused.attempts === 0 && refused.last_error.includes("quota"),
    "8b. the refused email waits, its attempt not counted, with Resend's reason recorded");
  check(Math.abs(Date.parse(refused.next_attempt_at) - (Date.now() + QUOTA_RETRY_MS)) < 60_000, "8c. ...and is tried again in an hour");
  check(qRows.filter((r) => r.id !== refused.id).every((r) => r.status === "pending" && !r.last_error), "8d. the other email is left untouched for later");
  mq.limitTimes(20, "quota");
  for (let k = 1; k <= 10; k++) await sendBookingEmails(db, mq, settings(), { bookingId: q, now: later(61 * k) });
  check((await emailsFor(q)).every((r) => r.status === "pending" && r.attempts === 0), "8e. ten more refusals over ten hours: still waiting, never marked failed");
  mq.limitTimes(0, "quota");
  await sendBookingEmails(db, mq, settings(), { bookingId: q, now: later(61 * 11) });
  check((await emailsFor(q)).every((r) => r.status === "sent"), "8f. once the quota resets, both are sent");
  const old = await request();
  await must(db.from("booking_emails").update({ created_at: new Date(Date.now() - 49 * 3600_000).toISOString() }).eq("booking_id", old));
  const mo = fakeMailer();
  mo.limitTimes(5, "quota");
  await sendBookingEmails(db, mo, settings(), { bookingId: old });
  check((await emailsFor(old)).some((r) => r.status === "failed" && r.last_error.includes("48 hours")), "8g. an email still blocked by the quota after 48 hours is marked failed, for the admin");
  const rt = await request();
  const mr = fakeMailer();
  mr.limitTimes(1, "rate");
  const rr = await sendBookingEmails(db, mr, settings(), { bookingId: rt });
  const rated = (await emailsFor(rt)).find((r) => r.last_error)!;
  check(!rr.limited && mr.sent.length === 1 && rated.attempts === 0 && Date.parse(rated.next_attempt_at) - Date.now() < 2 * 60_000,
    "8h. the per-second rate limit retries that email in a minute and carries on with the rest");

  // 6. What goes out has nothing private in it.
  check(m1.sent.every((x) => !x.text.includes(customer.email) && !x.html.includes(customer.email) && !x.text.includes("Customer")),
    "6. the emails sent don't contain the customer's email address or last name");
} catch (err) {
  failures++;
  console.error(`FAIL setup or run: ${(err as Error).message}`);
} finally {
  if (created.listings.length) {
    const ids = created.listings.map((i) => `'${i}'`).join(",");
    execFileSync("psql", [local.DB_URL!, "-q", "-c", `
      set session_replication_role = replica;
      delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
      delete from notifications where listing_id in (${ids});
      delete from bookings where listing_id in (${ids});
      delete from listing_photos where listing_id in (${ids});
      delete from listings where id in (${ids});`]);
  }
  if (created.provider) await db.from("providers").delete().eq("id", created.provider);
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  if (created.area) await db.from("service_areas").delete().eq("id", created.area);
  for (const id of created.categories) await db.from("categories").delete().eq("id", id);
}
console.log(failures ? `${failures} failed` : "All booking email sending checks passed.");
process.exit(failures ? 1 : 0);
