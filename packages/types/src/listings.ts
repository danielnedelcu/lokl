import { z } from "zod";
import type { Tables } from "./database";
import type { RpcJson } from "./rpcShapes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const LISTING_KINDS = ["service", "experience"] as const;
export const LISTING_STATUSES = ["draft", "submitted", "live", "rejected", "unpublished"] as const;
export const LOCATION_MODES = ["provider_location", "customer_location"] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type LocationMode = (typeof LOCATION_MODES)[number];

/**
 * How customers book a Service (docs/design/service-availability.md):
 * instant (they pay when they book, and it's confirmed) or approve (the card
 * is held until the provider accepts). Every Service has one; no default.
 */
export const BOOKING_MODES = ["instant", "approve"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

// Generated row types, with the text + check columns narrowed.
export type Listing = Omit<Tables<"listings">, "kind" | "status" | "location_mode"> & {
  kind: ListingKind;
  status: ListingStatus;
  location_mode: LocationMode | null;
};
export type ListingAddress = Tables<"listing_addresses">;

// ---------------------------------------------------------------------------
// Readiness: the database decides (listing_readiness(), 2026-10-20). It says
// what a listing needs before it can be published (Services) or sent for
// review (Experiences), in the checklist's words, and its trigger
// (listings_require_ready) refuses a move into live or submitted while a
// blocking item isn't done. The editor's checklist, the publish and submit
// routes and the admin review page all read it, so nothing here repeats the
// rules: only the keys, the admin's wording and which way each kind moves.
// ---------------------------------------------------------------------------

export const READINESS_KEYS = ["account", "photos", "address", "travel_areas", "sessions", "payouts"] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];
/** One checklist item, as listing_readiness() returns it (rpcShapes: listingReadinessShape). */
export type ReadinessItem = RpcJson<"listing_readiness">[number];

/** Where an Experience goes next (review) and where a Service goes (live at once). */
export function readinessTarget(kind: ListingKind): "submitted" | "live" {
  return kind === "service" ? "live" : "submitted";
}

/** Whether an item stops a listing moving to `target`. */
export function blocks(item: ReadinessItem, target: "submitted" | "live"): boolean {
  return target === "live" ? item.blocks_live : item.blocks_submit;
}

/**
 * The provider's next step and whether they can take it: publish (a Service
 * draft) or submit (an Experience draft, or one sent back), with every
 * blocking item done.
 */
export function readinessAction(kind: ListingKind, status: ListingStatus, items: ReadinessItem[]) {
  const action = kind === "service" ? ("publish" as const) : ("submit" as const);
  const fromOk = action === "publish" ? status === "draft" : status === "draft" || status === "rejected";
  const target = readinessTarget(kind);
  return { action, target, canAct: fromOk && items.every((i) => i.done || !blocks(i, target)) };
}

export function needsAddress(kind: ListingKind, locationMode: LocationMode | null): boolean {
  return kind === "experience" || locationMode === "provider_location";
}

// ---------------------------------------------------------------------------
// Editor form (validated in the page; the database checks the same rules)
// ---------------------------------------------------------------------------

const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).optional().transform((v) => v || null);

export const listingAddressSchema = z.object({
  line1: z.string().trim().min(3, "Enter the street address.").max(200, "Keep the address under 200 characters."),
  line2: optionalText(200, "Keep this line under 200 characters."),
  city: z.string().trim().min(2, "Enter the city.").max(80, "Keep the city under 80 characters."),
  state: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Enter the two-letter state code, like GA.")),
  postal_code: z
    .string()
    .trim()
    .regex(/^[0-9]{5}(-[0-9]{4})?$/, "Enter a five-digit zip code, like 30312."),
  instructions: optionalText(500, "Keep the arrival notes under 500 characters."),
});
export type ListingAddressInput = z.input<typeof listingAddressSchema>;

export const listingSchema = z
  .object({
    kind: z.enum(LISTING_KINDS),
    category_id: z.uuid("Choose a category."),
    city_id: z.uuid("Choose a metro area."),
    title: z
      .string()
      .trim()
      .min(5, "Give it a title of at least 5 characters.")
      .max(100, "Keep the title under 100 characters."),
    description: z
      .string()
      .trim()
      .min(20, "Describe it in at least 20 characters, so customers know what they get.")
      .max(5000, "Keep the description under 5,000 characters."),
    price_cents: z
      .number("Enter a price.")
      .int()
      .positive("Enter a price above $0."),
    // An empty number field means "not set" (it hands the form "", undefined or NaN).
    duration_minutes: z.preprocess(
      (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? null : Number(v)),
      z
        .number("Enter the length in minutes.")
        .int("Enter whole minutes.")
        .min(5, "Enter at least 5 minutes.")
        .max(1440, "Enter at most 1,440 minutes (24 hours).")
        .nullable(),
    ),
    location_mode: z.enum(LOCATION_MODES).nullable().optional(),
    // Services: how customers book (no default: the provider chooses), and
    // the free time after each booking (empty: the provider's default).
    booking_mode: z.enum(BOOKING_MODES).nullable().optional(),
    buffer_minutes: z.preprocess(
      (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? null : Number(v)),
      z.number().int("Enter whole minutes.").min(0, "Enter 0 minutes or more.").max(120, "Enter at most 120 minutes (2 hours).").nullable(),
    ).optional(),
    area_id: z.uuid().nullable().optional(),
    travel_area_ids: z.array(z.uuid()).default([]),
    address: listingAddressSchema.nullable().optional(),
  })
  .superRefine((l, ctx) => {
    if (l.kind === "experience" && l.duration_minutes == null) {
      ctx.addIssue({ code: "custom", path: ["duration_minutes"], message: "Enter how long the Experience lasts." });
    }
    if (l.kind === "service" && l.duration_minutes == null) {
      ctx.addIssue({ code: "custom", path: ["duration_minutes"], message: "Enter how long the Service takes." });
    } else if (l.kind === "service" && l.duration_minutes != null && (l.duration_minutes < 15 || l.duration_minutes > 720)) {
      ctx.addIssue({ code: "custom", path: ["duration_minutes"], message: "Enter 15 to 720 minutes (up to 12 hours) for a Service." });
    }
    if (l.kind === "service" && !l.booking_mode) {
      ctx.addIssue({ code: "custom", path: ["booking_mode"], message: "Choose how customers book this Service." });
    }
    if (l.kind === "service" && !l.location_mode) {
      ctx.addIssue({ code: "custom", path: ["location_mode"], message: "Choose where the Service happens." });
    }
    if (needsAddress(l.kind, l.location_mode ?? null) && !l.address) {
      ctx.addIssue({ code: "custom", path: ["address", "line1"], message: "Enter the street address." });
    }
    if (needsAddress(l.kind, l.location_mode ?? null) && !l.area_id) {
      ctx.addIssue({
        code: "custom",
        path: ["area_id"],
        message: "Choose the area customers will see, like the neighborhood.",
      });
    }
    // Run with the other fields' errors, not only once they're fixed, so an
    // empty form shows every problem at once (a Service's mode included).
  }, { when: (payload) => typeof payload.value === "object" && payload.value !== null });
export type ListingInput = z.input<typeof listingSchema>;
export type ListingOutput = z.output<typeof listingSchema>;

// ---------------------------------------------------------------------------
// Admin review: what stops a listing going live on approval or restore
// ---------------------------------------------------------------------------

/** The admin's wording for each readiness item, about the provider's listing: one per key (the listing-readiness app test checks every key the database returns has one). */
export const REVIEW_BLOCKER_LABELS: Record<ReadinessKey, string> = {
  account: "The provider's account is suspended",
  photos: "It has no photos",
  address: "It has no address",
  travel_areas: "It has no travel areas",
  sessions: "It has no upcoming sessions",
  payouts: "The provider hasn't finished setting up payouts",
};

/** What must be fixed before the admin can approve or restore a listing (everything that blocks going live). Empty when it can go live. */
export function reviewBlockers(items: ReadinessItem[]): string[] {
  return items.filter((i) => !i.done && i.blocks_live).map((i) => REVIEW_BLOCKER_LABELS[i.key]);
}

/** The reason the admin gives when rejecting or taking down a listing; the provider sees it. */
export const listingReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Give a reason of at least 10 characters.")
    .max(1000, "Keep the reason under 1,000 characters."),
});
export type ListingReasonInput = z.input<typeof listingReasonSchema>;
