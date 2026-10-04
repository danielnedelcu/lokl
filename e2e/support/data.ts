import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { testEnv, type TestEnv } from "./env";

// Test data for one journey, on the LOCAL stack, tagged with a run id and
// removed afterwards (cleanup). The same steps as the app tests
// (supabase/tests/app/booking-jobs.test.mts): rows written with the service
// role, and paid or held bookings made through Stripe's API with test
// payment methods, never by paying on Stripe's own page (decided 2026-10-04).

export interface TestUser {
  id: string;
  email: string;
  password: string;
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

  private constructor(readonly env: TestEnv, readonly cityId: string) {}

  static async create() {
    const env = await testEnv();
    const atl = await must(env.db.from("cities").select("id").eq("slug", "atlanta").single());
    return new TestData(env, atl.id as string);
  }

  async user(label: string, { admin = false } = {}): Promise<TestUser> {
    const email = `e2e-${label}-${this.run}@test.local`;
    const password = `e2e-${randomBytes(12).toString("hex")}`;
    const { data: made, error } = await this.env.db.auth.admin.createUser({
      email, password, email_confirm: true, ...(admin ? { app_metadata: { role: "admin" } } : {}),
    });
    const user = made.user;
    if (error || !user) throw new Error(`The test user wasn't created: ${error?.message ?? "no user"}`);
    this.users.push(user.id);
    return { id: user.id, email, password };
  }

  /** A provider with payouts set up on the sandbox's connected test account. */
  async provider(owner: TestUser, name = `E2E Provider ${this.run}`) {
    const id = (await must(this.env.db.from("providers").insert({ owner_id: owner.id, display_name: name, city_id: this.cityId }).select("id").single())).id as string;
    this.providers.push(id);
    await must(this.env.db.from("providers").update({
      stripe_account_id: this.env.connectedAccount, stripe_charges_enabled: true, stripe_payouts_enabled: true,
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

  /** A live listing at $50: an Experience, or a Service at the provider's own place (no address to give). */
  async listing(providerId: string, kind: "service" | "experience", categoryId: string, areaId: string): Promise<TestListing> {
    const id = randomUUID();
    const title = `E2E ${kind === "service" ? "Haircut" : "Food walk"} ${this.run}`;
    this.listings.push(id);
    await must(this.env.db.from("listings").insert({
      id, provider_id: providerId, city_id: this.cityId, area_id: areaId, status: "submitted", kind, category_id: categoryId, title,
      description: "A listing made by the end-to-end tests.", price_cents: 5000, duration_minutes: 60,
      location_mode: kind === "service" ? "provider_location" : null,
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
  async paidBooking(customer: TestUser, sessionId: string) {
    const b = await must(this.env.db.rpc("reserve_experience_booking", {
      p_session_id: sessionId, p_customer_id: customer.id, p_party_size: 1, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await this.env.stripe.paymentIntents.create({
      amount: 5000, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, payment_method_types: ["card"],
      metadata: { booking_id: b.id, test: "e2e" },
    });
    await must(this.env.db.schema("private").from("booking_records").update({
      status: "confirmed", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, stripe_charge_id: pi.latest_charge as string,
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id, charge: pi.latest_charge as string };
  }

  /** A Service request with the card held (manual capture), waiting for the provider. */
  async heldRequest(customer: TestUser, listingId: string, times: string[]) {
    const b = await must(this.env.db.rpc("create_service_request", {
      p_listing_id: listingId, p_customer_id: customer.id, p_preferred_times: times, p_customer_name: "Sam Customer",
      p_customer_email: customer.email, p_customer_phone: null, p_customer_notes: null, p_address: null,
      p_reserved_until: new Date(Date.now() + 31 * 60_000).toISOString(),
    })) as { id: string };
    const pi = await this.env.stripe.paymentIntents.create({
      amount: 5000, currency: "usd", capture_method: "manual", payment_method: "pm_card_visa", confirm: true,
      payment_method_types: ["card"], metadata: { booking_id: b.id, test: "e2e" },
    });
    await must(this.env.db.schema("private").from("booking_records").update({
      status: "requested", status_changed_by: "stripe", stripe_payment_intent_id: pi.id, respond_by: new Date(Date.now() + 2 * DAY).toISOString(),
    }).eq("id", b.id));
    return { id: b.id, pi: pi.id };
  }

  async booking(id: string) {
    return (await must(this.env.db.schema("private").from("booking_records").select("*").eq("id", id).single())) as Record<string, any>;
  }

  /** Test-only: a booking that ended yesterday and is due its payout (the guard trigger off, local database). */
  endedAndDue(bookingId: string) {
    execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
      alter table public.bookings disable trigger bookings_guard;
      update public.bookings set starts_at = now() - interval '30 hours', ends_at = now() - interval '29 hours',
        payout_due_at = now() - interval '5 hours' where id = '${bookingId}';
      alter table public.bookings enable trigger bookings_guard;`]);
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
    execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
      alter table public.bookings disable trigger bookings_guard;
      update public.bookings set status = 'confirmed', status_changed_by = 'stripe', confirmed_at = ${ended} - interval '3 days',
        starts_at = ${ended} - interval '1 hour', ends_at = ${ended}, payout_due_at = ${ended} + interval '1 day' where id = '${b.id}';
      update public.bookings set status = 'completed', status_changed_by = 'system' where id = '${b.id}';
      alter table public.bookings enable trigger bookings_guard;`]);
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
        alter table public.guides disable trigger guides_set_updated_at;
        update public.guides set updated_at = now() - interval '${fields.updatedHoursAgo} hours' where id = '${id}';
        alter table public.guides enable trigger guides_set_updated_at;`]);
    }
    return { id, slug };
  }
  trackGuide(id: string) {
    this.guides.push(id);
  }
  async guideExists(id: string) {
    const { data } = await this.env.db.from("guides").select("id").eq("id", id).maybeSingle();
    return !!data;
  }

  async cleanup() {
    for (const id of this.guides) await this.env.db.from("guides").delete().eq("id", id).is("published_at", null);
    // Bookings are never deleted in real use; the tests remove their own rows directly.
    if (this.listings.length) {
      const ids = this.listings.map((i) => `'${i}'`).join(",");
      execFileSync("psql", [this.env.dbUrl, "-q", "-c", `
        set session_replication_role = replica;
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
        delete from provider_emails where provider_id in (${ids});
        delete from saved_providers where provider_id in (${ids});
        delete from provider_ratings where provider_id in (${ids});
        delete from admin_actions where target = 'provider' and target_id in (${ids});`]);
    }
    for (const id of this.providers) await this.env.db.from("providers").delete().eq("id", id);
    for (const id of this.users) await this.env.db.auth.admin.deleteUser(id);
    for (const id of this.areas) await this.env.db.from("service_areas").delete().eq("id", id);
    for (const id of this.categories) await this.env.db.from("categories").delete().eq("id", id);
  }
}
