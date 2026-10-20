import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_SESSION_HEADER } from "@repo/types";
import { testEnv, type TestEnv } from "./env";
import { authenticatorKeys, freshTotp } from "./totp";

// Test data for one journey, on the LOCAL stack, tagged with a run id and
// removed afterwards (cleanup). The same steps as the app tests
// (supabase/tests/app/booking-jobs.test.mts): rows written with the service
// role, and paid or held bookings made through Stripe's API with test
// payment methods, never by paying on Stripe's own page (decided 2026-10-04).

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** An admin's session that passed the second step (for admin functions run as the server). */
  adminSession?: string;
}
export interface TestListing {
  id: string;
  slug: string;
  title: string;
}

const DAY = 864e5;

// Setup rows are untyped on purpose (several schemas, RPCs); the tests check what matters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * SQL that removes published guides (`ids`: a parenthesised list or
 * subquery) with their homepage places, versions and photos. Published
 * guides can't be deleted and versions are append-only, so it runs with
 * triggers off for this session (replica), which also skips the foreign
 * keys' cascades and the content-version bump: it removes the children
 * itself and raises the guides version afterwards, so cached pages drop
 * the guides at once. Never `alter table … disable trigger` (check:test-ddl).
 */
function removeGuidesSql(ids: string) {
  return `
    set session_replication_role = replica;
    delete from public.homepage_features where guide_id in ${ids};
    delete from public.guide_versions where guide_id in ${ids};
    update public.guide_ai_drafts set guide_id = null where guide_id in ${ids};
    delete from public.guide_photos where guide_id in ${ids};
    delete from public.guides where id in ${ids};
    set session_replication_role = origin;
    update public.public_content_versions set version = version + 1, changed_at = now() where scope = 'guides';`;
}

/** A start time `days` from now, on the hour at 14:00 UTC (10 AM in Atlanta in summer, 9 AM in winter). */
export function daysFromNow(days: number) {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}

/** How the website shows a time: "10:00 AM" in Atlanta (formatSessionTime). */
export const atlantaTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
/** How the website shows a date: "Wed, Oct 8" in Atlanta (formatSessionDate). */
export const atlantaDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(iso));

export class TestData {
  readonly run = randomBytes(4).toString("hex");
  private users: string[] = [];
  private providers: string[] = [];
  private listings: string[] = [];
  private categories: string[] = [];
  private areas: string[] = [];
  private guides: string[] = [];
  private publishedGuides: string[] = [];
  private cities: string[] = [];
  private guideCategory: Promise<{ id: string }> | null = null;

  private constructor(readonly env: TestEnv, readonly cityId: string) {}

  static async create() {
    const env = await testEnv();
    const atl = await must(env.db.from("cities").select("id").eq("slug", "atlanta").single());
    return new TestData(env, atl.id as string);
  }

  /**
   * A login. With `admin`, a member of lokl's team (admin_members; "owner"
   * unless "support" is given) who has set up an authenticator, as joining
   * requires (docs/design/admin-roles.md): its key is remembered for
   * signIn, and the session that set it up is kept for admin functions.
   * `authenticator: false` leaves that to the test (journey 38);
   * `invited` makes them invited, not yet joined.
   */
  async user(label: string, { admin = false as boolean | "owner" | "support", authenticator = true, invited = false } = {}): Promise<TestUser> {
    const email = `e2e-${label}-${this.run}@test.local`;
    const password = `e2e-${randomBytes(12).toString("hex")}`;
    const { data: made, error } = await this.env.db.auth.admin.createUser({ email, password, email_confirm: true });
    const user = made.user;
    if (error || !user) throw new Error(`The test user wasn't created: ${error?.message ?? "no user"}`);
    this.users.push(user.id);
    if (!admin) return { id: user.id, email, password };
    await must(this.env.db.from("admin_members").insert({
      user_id: user.id, role: admin === "support" ? "support" : "owner",
      ...(invited ? { status: "invited" } : { status: "active", joined_at: new Date().toISOString() }),
    }));
    if (!authenticator) return { id: user.id, email, password };
    const client = createClient(this.env.apiUrl, this.env.publishableKey, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`The test admin couldn't sign in: ${signedIn.error.message}`);
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Phone" });
    if (enrolled.error) throw new Error(`The test admin's authenticator wasn't set up: ${enrolled.error.message}`);
    // freshTotp starts from the previous 30 seconds' code, so signIn's next
    // code needs no wait.
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: await freshTotp(enrolled.data.totp.secret) });
    if (verified.error) throw new Error(`The test admin's authenticator wasn't confirmed: ${verified.error.message}`);
    authenticatorKeys.set(email, enrolled.data.totp.secret);
    const token = verified.data.access_token;
    const adminSession = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).session_id as string;
    return { id: user.id, email, password, adminSession };
  }

  /** A login the app made itself (the Team page's invitation), removed with the rest. */
  trackUser(id: string) {
    this.users.push(id);
  }

  /**
   * A provider with payouts set up, on a made-up Stripe account of its own
   * (an account belongs to one provider, so tests running side by side
   * can't share one; nothing but a payout uses it). With
   * `connectedAccount`, on the sandbox's real connected test account
   * instead, for a journey that pays the provider (only one at a time can
   * hold it: tag that test @serial).
   */
  async provider(owner: TestUser, name = `E2E Provider ${this.run}`, { connectedAccount = false } = {}) {
    const id = (await must(this.env.db.from("providers").insert({ owner_id: owner.id, display_name: name, city_id: this.cityId }).select("id").single())).id as string;
    this.providers.push(id);
    await must(this.env.db.from("providers").update({
      stripe_account_id: connectedAccount ? this.env.connectedAccount : `acct_e2e_${randomBytes(6).toString("hex")}`,
      stripe_charges_enabled: true, stripe_payouts_enabled: true,
    }).eq("id", id));
    return id;
  }

  async category(kind: "service" | "experience") {
    const name = `E2E ${kind} ${this.run}`;
    const slug = `e2e-${kind}-${this.run}`;
    const id = (await must(this.env.db.from("categories").insert({ kind, name, slug }).select("id").single())).id as string;
    this.categories.push(id);
    return { id, name, slug };
  }

  async area() {
    const id = (await must(this.env.db.from("service_areas").insert({ city_id: this.cityId, kind: "neighborhood", name: `E2E ${this.run}` }).select("id").single())).id as string;
    this.areas.push(id);
    return id;
  }

  /**
   * A live listing at $50: an Experience, or a Service at the provider's own
   * place (no address to give), booked Instant or by approval (`mode`, a
   * choice the database requires of every Service; approve unless said).
   */
  async listing(providerId: string, kind: "service" | "experience", categoryId: string, areaId: string, titled?: string,
    mode: "instant" | "approve" = "approve"): Promise<TestListing> {
    const id = randomUUID();
    const title = titled ?? `E2E ${kind === "service" ? "Haircut" : "Food walk"} ${this.run}`;
    this.listings.push(id);
    await must(this.env.db.from("listings").insert({
      id, provider_id: providerId, city_id: this.cityId, area_id: areaId, status: "submitted", kind, category_id: categoryId, title,
      description: "A listing made by the end-to-end tests.", price_cents: 5000, duration_minutes: 60,
      location_mode: kind === "service" ? "provider_location" : null, booking_mode: kind === "service" ? mode : null,
    }));
    await must(this.env.db.from("listing_photos").insert({ listing_id: id, storage_path: `${providerId}/${id}/${randomUUID()}.jpg`, position: 0, alt_text: "A test photo" }));
    const row = await must(this.env.db.from("listings").update({ status: "live", published_at: new Date().toISOString() }).eq("id", id).select("slug").single());
    return { id, slug: row.slug as string, title };
  }

  async session(listingId: string, startsAt: string, capacity = 4) {
    return (await must(this.env.db.from("experience_sessions").insert({ listing_id: listingId, starts_at: startsAt, capacity }).select("id").single())).id as string;
  }

  async spotsLeft(sessionId: string) {
    return (await must(this.env.db.rpc("session_spots_left", { p_session_id: sessionId }))) as number;
  }

  /** A paid, confirmed Experience booking, as Checkout leaves it (charged with funds available for a payout). */
  /** A paid Experience booking: `people` at the listing's $50 each (a real sandbox payment). */
  async paidBooking(customer: TestUser, sessionId: string, people = 1) {
    const b = await must(this.env.db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: people, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await this.env.stripe.paymentIntents.create({
      amount: 5000 * people, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"],
      metadata: { booking_id: b.id, test: "e2e" },
    });
    await must(this.env.db.schema("private").from("booking_records").update({
      status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string,
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id, charge: pi.latest_charge as string };
  }

  /**
   * Opens a provider for bookings (docs/design/service-availability.md):
   * the same hours every day, in Atlanta time, 9:00 AM to 5:00 PM unless
   * said. Services are booked from these times only.
   */
  async hours(providerId: string, starts = "09:00", ends = "17:00") {
    await must(this.env.db.from("provider_weekly_hours").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ provider_id: providerId, weekday, starts, ends })),
    ));
  }

  /** The first free time of a Service at least `afterDays` from now (its provider must have hours). */
  async slot(listingId: string, afterDays = 3): Promise<string> {
    const from = new Date(Date.now() + afterDays * DAY);
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    const slots = await must(this.env.db.rpc("service_slots", { p_listing_id: listingId, p_from: day(from), p_to: day(new Date(from.getTime() + 6 * DAY)) })) as { starts_at: string }[];
    const slot = slots.map((s) => s.starts_at).find((s) => Date.parse(s) >= from.getTime());
    if (!slot) throw new Error("No free time: give the provider hours (data.hours) first.");
    return new Date(slot).toISOString();
  }

  /** A Service request for one of its times, with the card held (manual capture), waiting for the provider. */
  async heldRequest(customer: TestUser, listingId: string, startsAt?: string) {
    const b = await must(this.env.db.rpc("create_service_booking", {
      p_listing_id: listingId, p_customer_id: customer.id, p_starts_at: startsAt ?? await this.slot(listingId), p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string; starts_at: string };
    const pi = await this.env.stripe.paymentIntents.create({
      amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true,
      payment_method_types: ["card"], metadata: { booking_id: b.id, test: "e2e" },
    });
    await must(this.env.db.schema("private").from("booking_records").update({
      status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, respond_by: new Date(Date.now() + 2 * DAY).toISOString(),
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id, startsAt: new Date(b.starts_at).toISOString() };
  }

  async booking(id: string) {
    return (await must(this.env.db.schema("private").from("booking_records").select("*").eq("id", id).single())) as Record<string, any>;
  }

  /**
   * Test-only: a booking that ended yesterday and is due its payout (triggers
   * off for this session only, local database). Never `alter table … disable
   * trigger`: that's a schema change, and PostgREST reloads and resets its
   * connections mid-run, failing other tests' requests (check:test-ddl).
   */
  endedAndDue(bookingId: string) {
    execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
      set session_replication_role = replica;
      update public.bookings set starts_at = now() - interval '30 hours', ends_at = now() - interval '29 hours',
        payout_due_at = now() - interval '5 hours' where id = '${bookingId}';`]);
  }

  /**
   * The database's clock, in milliseconds: for a time the database will
   * compare with its own now() (a notice, a free-cancellation hour), so a
   * difference between this machine's clock and the database's can't move
   * it across a line (2026-10-18).
   */
  dbNow(): number {
    return Date.parse(execFileSync("psql", [this.env.dbUrl, "-qAt", "-c", "select to_json(now())#>>'{}'"], { encoding: "utf8" }).trim());
  }

  /** Test-only: a problem report resolved `days` days ago (triggers off, local database). */
  resolvedDaysAgo(reportId: string, days: number) {
    execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
      set session_replication_role = replica;
      update public.support_reports set status = 'done', resolved_at = now() - interval '${Number(days)} days' where id = '${reportId}';`]);
  }

  /**
   * Test-only: a booking that took place, `endedDaysAgo` days ago, and was
   * completed by the pay-out job (so the review request is queued), with no
   * payment (reviews don't need one; the guard trigger off, local database).
   */
  private sessions = 0;

  async completedBooking(customer: TestUser, listingId: string, { name = "Sam Customer", endedDaysAgo = 1 } = {}) {
    // A session each, an hour apart (a listing can't have two at one time).
    const sessionId = await this.session(listingId, new Date(Date.parse(daysFromNow(3)) + this.sessions++ * 3600_000).toISOString());
    const b = await must(this.env.db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: 1, p_customer_name: name,
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const ended = `now() - interval '${endedDaysAgo} days'`;
    // The status changes run with every trigger (events, emails, the review
    // request); only moving the times into the past skips them.
    execFileSync("psql", [this.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", `
      update public.bookings set status = 'confirmed', status_changed_by = 'stripe' where id = '${b.id}';
      set local session_replication_role = replica;
      update public.bookings set confirmed_at = ${ended} - interval '3 days',
        starts_at = ${ended} - interval '1 hour', ends_at = ${ended}, payout_due_at = ${ended} + interval '1 day' where id = '${b.id}';
      set local session_replication_role = origin;
      update public.bookings set status = 'completed', status_changed_by = 'system' where id = '${b.id}';`]);
    return b.id;
  }

  /** Test-only: a published review, written as the database would take it (the service role skips the form). */
  async review(bookingId: string, rating: number, body: string) {
    return (await must(this.env.db.from("reviews").insert({ booking_id: bookingId, rating, body } as never).select("id").single())).id as string;
  }

  /** Run a timed job through its route, as the scheduler does. */
  async job(name: string) {
    const res = await fetch(`http://localhost:3200/api/jobs/${name}`, { method: "POST", headers: { "x-job-secret": this.env.jobSecret } });
    if (!res.ok) throw new Error(`The ${name} job answered ${res.status}.`);
    return res.json();
  }

  /** A never-published guide in Atlanta (or an id made by the app, to remove afterwards). */
  async guide(fields: { title?: string; updatedHoursAgo?: number } = {}) {
    const slug = `e2e-guide-${this.run}-${randomBytes(2).toString("hex")}`;
    const id = (await must(this.env.db.from("guides").insert({ market_id: this.cityId, slug, draft_title: fields.title ?? "" }).select("id").single())).id as string;
    this.guides.push(id);
    if (fields.updatedHoursAgo) {
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
        set session_replication_role = replica;
        update public.guides set updated_at = now() - interval '${fields.updatedHoursAgo} hours' where id = '${id}';`]);
    }
    return { id, slug };
  }
  /**
   * A published guide with a cover, in Atlanta or the given market, as the
   * admin publishes it (publish_guide). Removed afterwards with its homepage
   * place and its versions (test-only: the versions log's guard is switched
   * off for that, as in guides-public.test.mts).
   */
  async publishedGuide(title: string, admin: TestUser, marketId = this.cityId) {
    const slug = `e2e-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${this.run}`;
    const area = (await must(this.env.db.from("service_areas").insert({ city_id: marketId, kind: "neighborhood", name: `E2E ${title} ${this.run}` }).select("id").single())).id as string;
    this.areas.push(area);
    const teaser = `A walk around ${title}, and who to book for it.`;
    const g = (await must(this.env.db.from("guides").insert({
      market_id: marketId, slug, draft_title: title, draft_teaser: teaser,
      draft_category_id: (await (this.guideCategory ??= this.category("experience"))).id, draft_area_id: area,
      draft_body: { blocks: [{ type: "paragraph", data: { text: "The live words." } }] },
    }).select("id").single())).id as string;
    this.publishedGuides.push(g);
    const photo = (await must(this.env.db.from("guide_photos").insert({
      guide_id: g, storage_path: `${g}/${randomUUID()}.webp`, width: 2400, height: 1350, alt_text: `The cover of ${title}`, source: "own",
    }).select("id").single())).id as string;
    await must(this.env.db.from("guides").update({ draft_cover_photo_id: photo }).eq("id", g));
    // The server key acting for the admin's session, as the admin app's route does.
    if (!admin.adminSession) throw new Error("publishedGuide needs an admin with an authenticator.");
    const server = createClient(this.env.apiUrl, this.env.secretKey, {
      auth: { persistSession: false }, global: { headers: { [ADMIN_SESSION_HEADER]: admin.adminSession } },
    });
    await must(server.rpc("publish_guide", { p_guide_id: g, p_admin_id: admin.id }));
    return { id: g, slug, title, teaser };
  }
  /** A market of its own (for closing it in a test); removed afterwards. */
  async market(name: string) {
    const id = (await must(this.env.db.from("cities").insert({ slug: `e2e-${this.run}-${randomBytes(2).toString("hex")}`, name, state: "GA", timezone: "America/New_York" }).select("id").single())).id as string;
    this.cities.push(id);
    return id;
  }
  /** Sets the homepage's guides directly: the first is the main guide (position 1), or none with `{ main: false }`. */
  async setHomepage(ids: string[], { main = true } = {}) {
    await must(this.env.db.from("homepage_features").delete().gte("position", 1));
    if (ids.length) await must(this.env.db.from("homepage_features").insert(ids.map((guide_id, i) => ({ position: i + (main ? 1 : 2), guide_id }))));
  }

  trackGuide(id: string) {
    this.guides.push(id);
  }
  async guideExists(id: string) {
    const { data } = await this.env.db.from("guides").select("id").eq("id", id).maybeSingle();
    return !!data;
  }

  async cleanup() {
    // Problem reports point at the providers, listings and bookings, so they
    // go first (never deleted in real use; the guards are off here, locally).
    if (this.providers.length) {
      const ids = this.providers.map((i) => `'${i}'`).join(",");
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
        set session_replication_role = replica;
        delete from notifications where support_report_id in (select id from support_reports where provider_id in (${ids}));
        delete from admin_notifications where report_id in (select id from support_reports where provider_id in (${ids}));
        delete from support_emails where report_id in (select id from support_reports where provider_id in (${ids}));
        delete from support_notes where report_id in (select id from support_reports where provider_id in (${ids}));
        delete from support_messages where report_id in (select id from support_reports where provider_id in (${ids}));
        delete from support_report_events where report_id in (select id from support_reports where provider_id in (${ids}));
        delete from support_reports where provider_id in (${ids});`]);
    }
    for (const id of this.guides) await this.env.db.from("guides").delete().eq("id", id).is("published_at", null);
    if (this.publishedGuides.length) {
      const ids = this.publishedGuides.map((i) => `'${i}'`).join(",");
      execFileSync("psql", [this.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", `
        ${removeGuidesSql(`(${ids})`)}`]);
    }
    // Bookings are never deleted in real use; the tests remove their own rows directly.
    if (this.listings.length) {
      const ids = this.listings.map((i) => `'${i}'`).join(",");
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
        set session_replication_role = replica;
        delete from admin_notifications where admin_request_id in (select id from admin_requests where booking_id in (select id from bookings where listing_id in (${ids})));
        delete from admin_emails where admin_action_id in (select id from admin_actions where request_id in (select id from admin_requests where booking_id in (select id from bookings where listing_id in (${ids}))));
        delete from admin_actions where request_id in (select id from admin_requests where booking_id in (select id from bookings where listing_id in (${ids})));
        delete from admin_requests where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from admin_contact_views where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from admin_refund_holds where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from admin_actions where target = 'review' and target_id in (select id from reviews where listing_id in (${ids}));
        delete from review_reports where review_id in (select id from reviews where listing_id in (${ids}));
        delete from review_replies where review_id in (select id from reviews where listing_id in (${ids}));
        delete from reviews where listing_id in (${ids});
        delete from listing_ratings where listing_id in (${ids});
        delete from booking_emails where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from booking_finances where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from booking_reports where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from booking_events where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from booking_contacts where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from booking_addresses where booking_id in (select id from bookings where listing_id in (${ids}));
        delete from notifications where listing_id in (${ids});
        delete from bookings where listing_id in (${ids});
        delete from experience_sessions where listing_id in (${ids});
        delete from listing_photos where listing_id in (${ids});
        delete from listings where id in (${ids});`]);
    }
    if (this.providers.length) {
      // Profile photos, and the account emails, admin log rows and saves that point at the provider.
      for (const id of this.providers) {
        const { data: files } = await this.env.db.storage.from("provider-photos").list(id);
        if (files?.length) await this.env.db.storage.from("provider-photos").remove(files.map((f) => `${id}/${f.name}`));
      }
      const ids = this.providers.map((i) => `'${i}'`).join(",");
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
        set session_replication_role = replica;
        delete from admin_notifications where admin_request_id in (select id from admin_requests where provider_id in (${ids}));
        delete from admin_emails where admin_action_id in (select id from admin_actions where request_id in (select id from admin_requests where provider_id in (${ids})));
        delete from admin_actions where request_id in (select id from admin_requests where provider_id in (${ids}));
        delete from admin_requests where provider_id in (${ids});
        delete from admin_contact_views where provider_id in (${ids});
        delete from provider_emails where provider_id in (${ids});
        delete from saved_providers where provider_id in (${ids});
        delete from provider_ratings where provider_id in (${ids});
        delete from admin_actions where target = 'provider' and target_id in (${ids});`]);
    }
    for (const id of this.providers) await this.env.db.from("providers").delete().eq("id", id);
    // Team members are never deleted, and a login on the team can't be (local
    // only). Any of this run's logins, since a journey may add one by hand.
    if (this.users.length) {
      const ids = this.users.map((i) => `'${i}'`).join(",");
      // With the team changes they made or were the subject of: the log, its alerts and emails.
      const actions = `select id from admin_actions where target = 'admin_member' and (target_id in (${ids}) or admin_id in (${ids}))`;
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `set session_replication_role = replica;
        delete from admin_notifications where admin_action_id in (${actions});
        delete from admin_emails where admin_action_id in (${actions});
        delete from admin_actions where id in (${actions});
        delete from admin_members where user_id in (${ids});`]);
    }
    for (const id of this.users) await this.env.db.auth.admin.deleteUser(id);
    for (const id of this.areas) await this.env.db.from("service_areas").delete().eq("id", id);
    for (const id of this.categories) await this.env.db.from("categories").delete().eq("id", id);
    for (const id of this.cities) await this.env.db.from("cities").delete().eq("id", id);
  }
}
