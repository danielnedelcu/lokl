import { z } from "zod";
import type { Tables } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const LISTING_KINDS = ["service", "experience"] as const;
export const LISTING_STATUSES = ["draft", "submitted", "live", "rejected", "unpublished"] as const;
export const LOCATION_MODES = ["provider_location", "customer_location"] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type LocationMode = (typeof LOCATION_MODES)[number];

// Generated row types, with the text + check columns narrowed.
export type Listing = Omit<Tables<"listings">, "kind" | "status" | "location_mode"> & {
  kind: ListingKind;
  status: ListingStatus;
  location_mode: LocationMode | null;
};
export type ListingAddress = Tables<"listing_addresses">;

// ---------------------------------------------------------------------------
// Readiness: the one place that decides whether a listing can be published
// (Services) or submitted for review (Experiences). The editor's checklist
// and the publish/submit server routes both call it, so they can't disagree.
// The database enforces the photo rule too (listings_require_photo).
// ---------------------------------------------------------------------------

export interface ReadinessFacts {
  kind: ListingKind;
  status: ListingStatus;
  locationMode: LocationMode | null;
  hasAddress: boolean;
  travelAreaCount: number;
  photoCount: number;
  /** Future, scheduled sessions (Experiences). */
  upcomingSessionCount: number;
  providerActive: boolean;
  payoutsReady: boolean;
}

export interface ReadinessItem {
  key: "account" | "photos" | "address" | "travel_areas" | "sessions" | "payouts";
  label: string;
  done: boolean;
  /** When false, the item is shown but doesn't block the action. */
  blocking: boolean;
}

export function needsAddress(kind: ListingKind, locationMode: LocationMode | null): boolean {
  return kind === "experience" || locationMode === "provider_location";
}

export function listingReadiness(f: ReadinessFacts): {
  items: ReadinessItem[];
  action: "publish" | "submit";
  canAct: boolean;
} {
  const items: ReadinessItem[] = [
    { key: "account", label: "Your account is active", done: f.providerActive, blocking: true },
    { key: "photos", label: "Add at least one photo", done: f.photoCount > 0, blocking: true },
  ];
  if (needsAddress(f.kind, f.locationMode)) {
    items.push({
      key: "address",
      label: f.kind === "experience" ? "Add the meeting address" : "Add your address",
      done: f.hasAddress,
      blocking: true,
    });
  }
  if (f.kind === "service" && f.locationMode === "customer_location") {
    items.push({
      key: "travel_areas",
      label: "Choose at least one area you travel to",
      done: f.travelAreaCount > 0,
      blocking: true,
    });
  }
  // Without sessions a live Experience can be seen but not booked. That's
  // allowed (a host may add dates after approval), so it's a nudge, not a block.
  if (f.kind === "experience") {
    items.push({
      key: "sessions",
      label: "Add at least one upcoming session so customers can book",
      done: f.upcomingSessionCount > 0,
      blocking: false,
    });
  }
  // Services go live straight away, so payouts must be ready first.
  // Experiences can be submitted before payouts are set up, but lokl can't
  // approve them until they are.
  items.push({
    key: "payouts",
    label: f.kind === "service" ? "Set up payouts" : "Set up payouts (needed before we can approve it)",
    done: f.payoutsReady,
    blocking: f.kind === "service",
  });

  const action = f.kind === "service" ? "publish" : "submit";
  const fromOk = action === "publish" ? f.status === "draft" : f.status === "draft" || f.status === "rejected";
  const canAct = fromOk && items.every((i) => i.done || !i.blocking);
  return { items, action, canAct };
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
    city_id: z.uuid("Choose a city."),
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
    // A number input hands the form a string; an empty one means "not set".
    duration_minutes: z.preprocess(
      (v) => (v === "" || v == null ? null : Number(v)),
      z
        .number("Enter the length in minutes.")
        .int("Enter whole minutes.")
        .min(5, "Enter at least 5 minutes.")
        .max(1440, "Enter at most 1,440 minutes (24 hours).")
        .nullable(),
    ),
    location_mode: z.enum(LOCATION_MODES).nullable().optional(),
    area_id: z.uuid().nullable().optional(),
    travel_area_ids: z.array(z.uuid()).default([]),
    address: listingAddressSchema.nullable().optional(),
  })
  .superRefine((l, ctx) => {
    if (l.kind === "experience" && l.duration_minutes == null) {
      ctx.addIssue({ code: "custom", path: ["duration_minutes"], message: "Enter how long the Experience lasts." });
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
  });
export type ListingInput = z.input<typeof listingSchema>;
export type ListingOutput = z.output<typeof listingSchema>;
