import { z } from "zod";
import { LISTING_STATUSES, READINESS_KEYS } from "./listings";
import { GUIDE_PHOTO_SOURCES } from "./guides";
import { REVIEW_RULES, type ReviewRule } from "./reviews";

// The shape of every database function the apps call that returns JSON
// (2026-10-17). The generated types say only `Json` for these, so each is
// described here, once, and read through rpcJson (./rpcJson.ts), which checks
// it: a function whose JSON drifts (a key renamed, a type changed) fails the
// tests by name and path instead of quietly showing zeros or empty lists.
// The TypeScript types below come from these schemas.
//
// Missing keys and wrong types fail; extra keys are allowed (and dropped),
// so a function can gain a field before the apps use it.
// scripts/check-rpc-json.mjs fails on an rpc() call to one of these that
// isn't read through rpcJson, and on a JSON function with no schema here.

const id = z.string();
const time = z.string();
const kind = z.enum(["service", "experience"]);
const reviewRule = z.enum(Object.keys(REVIEW_RULES) as [ReviewRule, ...ReviewRule[]]);
/** A count from Postgres: bigint counts arrive as JSON numbers. */
const count = z.number().int();

// ---- Listings ----------------------------------------------------------------

/** listing_readiness(): the checklist, in order (the database holds the rules and the provider's wording). */
export const listingReadinessShape = z.array(z.object({
  key: z.enum(READINESS_KEYS),
  label: z.string(),
  done: z.boolean(),
  blocks_live: z.boolean(),
  blocks_submit: z.boolean(),
}));

// ---- Public pages ------------------------------------------------------------

export const publicBrowseShape = z.object({
  total: count,
  ids: z.array(id),
  /** Services on the page with no free time in their window (undated browse). */
  closed: z.array(id).optional(),
  /** Services on the page: their first free day in the searched dates. */
  firstDays: z.record(z.string(), z.string()).optional(),
});

/** Visible listings per category id. */
export const publicCategoryCountsShape = z.record(z.string(), count);

const guidePhoto = z.object({
  id,
  path: z.string(),
  card_path: z.string().nullable(),
  width: z.number(),
  height: z.number(),
  alt: z.string(),
  source: z.enum(GUIDE_PHOTO_SOURCES),
  credit_name: z.string().nullable(),
  credit_url: z.string().nullable(),
  source_url: z.string().nullable(),
  licence: z.string().nullable(),
});
const guideMarket = z.object({ name: z.string(), slug: z.string(), state: z.string(), timezone: z.string() });

/** One market's published guides; null for a market that isn't public. */
export const publicGuidesShape = z.object({
  market: guideMarket,
  guides: z.array(z.object({
    slug: z.string(), title: z.string(), teaser: z.string(),
    published_at: time, content_updated_at: time, cover: guidePhoto,
  })),
}).nullable();

/** One published guide; null when there's no such guide. */
export const publicGuideShape = z.object({
  slug: z.string(),
  title: z.string(),
  teaser: z.string(),
  body: z.unknown(),
  published_at: time,
  content_updated_at: time,
  market: guideMarket,
  listings: z.object({
    kind: kind.nullable(),
    area: z.object({ id, name: z.string(), kind: z.string() }).nullable(),
    category: z.object({ id, name: z.string(), slug: z.string(), kind }).nullable(),
  }),
  cover_photo_id: id,
  photos: z.array(guidePhoto),
}).nullable();

export const publicHomepageGuidesShape = z.array(z.object({
  position: z.number().int(),
  market: z.string(),
  slug: z.string(),
  title: z.string(),
  teaser: z.string(),
  cover: guidePhoto,
}));

// ---- Signed-in customers and providers ----------------------------------------

export const mySavedShape = z.object({
  listings: z.array(z.object({ listing_id: id, saved_at: time, available: z.boolean(), title: z.string().nullable() })),
  providers: z.array(z.object({ provider_id: id, saved_at: time, available: z.boolean(), name: z.string().nullable() })),
});

export const listingSessionsPageShape = z.object({
  total: count,
  items: z.array(z.object({
    id,
    starts_at: time,
    capacity: z.number().int(),
    status: z.enum(["scheduled", "cancelled"]),
    /** Booking rows of any kind: any at all means it can't be deleted, only cancelled with refunds. */
    booking_rows: z.number().int(),
    /** People on confirmed bookings, and what cancelling would refund them. */
    booked: z.number().int(),
    refund_cents: z.number().int(),
  })),
});

/** A booking's review, for whoever may see it; null for anyone else. */
export const reviewStateShape = z.object({
  role: z.enum(["customer", "provider", "admin"]),
  window_ends_at: time.nullable(),
  can_write: z.boolean(),
  why_not: z.string().nullable(),
  reviewer_name: z.string(),
  review: z.object({
    id, rating: z.number().int(), body: z.string(), created_at: time, edited_at: time.nullable(),
    status: z.enum(["published", "removed"]), removed_rule: reviewRule.nullable(), can_change: z.boolean(),
  }).nullable(),
  reply: z.object({
    body: z.string(), created_at: time, edited_at: time.nullable(),
    status: z.enum(["published", "removed"]), removed_rule: reviewRule.nullable(),
  }).nullable(),
}).nullable();

/** The provider's problem reports, a page at a time (my_support_reports). */
export const mySupportReportsShape = z.object({
  total: count,
  waiting: count,
  rows: z.array(z.object({
    id,
    category: z.enum(["booking", "payments", "listing", "website", "safety", "other"]),
    urgent: z.boolean(),
    excerpt: z.string(),
    status: z.enum(["todo", "in_progress", "waiting", "done"]),
    status_changed_at: time,
    resolved_at: time.nullable(),
    last_message_at: time,
    last_message_from: z.enum(["provider", "admin"]),
    created_at: time,
    listing: z.object({ id, title: z.string() }).nullable(),
    booking: z.object({ id, starts_at: time.nullable() }).nullable(),
  })),
});

// ---- Jobs ------------------------------------------------------------------------

export const refreshStaleServiceOpenDaysShape = z.object({ refreshed: count, more_waiting: z.boolean() });

// ---- Admin -------------------------------------------------------------------------

/** One page of an admin table (the admin_*_page functions). */
const serverPage = <Row extends z.ZodType>(row: Row) => z.object({ rows: z.array(row), total: count, total_exact: z.boolean() });

export const adminBookingRowShape = z.object({
  id,
  kind,
  status: z.string(),
  listing_id: id,
  provider_id: id,
  starts_at: time.nullable(),
  ends_at: time.nullable(),
  created_at: time,
  party_size: z.number().int(),
  total_cents: z.number().int(),
  commission_cents: z.number().int(),
  provider_amount_cents: z.number().int(),
  refunded_cents: z.number().int(),
  cancelled_by: z.string().nullable(),
  confirmed_at: time.nullable(),
  payout_due_at: time.nullable(),
  payout_hold: z.string().nullable(),
  payout_failure: z.string().nullable(),
  stripe_transfer_id: z.string().nullable(),
  problem_reported_at: time.nullable(),
  problem_resolution: z.string().nullable(),
  disputed_at: time.nullable(),
  dispute_closed_at: time.nullable(),
  dispute_outcome: z.string().nullable(),
  reversal_failed_at: time.nullable(),
  customer_name: z.string(),
  customer_email: z.string().nullable().optional(),
  listing: z.object({
    title: z.string(), kind: z.string(), status: z.string(),
    city: z.object({ name: z.string(), timezone: z.string() }).nullable(),
  }).nullable(),
  provider: z.object({ display_name: z.string(), status: z.string() }).nullable(),
});
/** The groups the admin's bookings page counts as needing attention. */
export const ADMIN_BOOKING_ATTENTION = ["reports", "holds", "owed", "disputes", "unavailable"] as const;
export const adminBookingsPageShape = serverPage(adminBookingRowShape).extend({
  /** The money across every match. */
  totals: z.object({ charged_count: count, charged_cents: count, refunded_cents: count, commission_cents: count }),
  /** Counts per attention group, across every booking (with p_with_attention only). */
  attention: z.record(z.enum(ADMIN_BOOKING_ATTENTION), count).nullable(),
});

export const adminListingRowShape = z.object({
  id,
  title: z.string(),
  status: z.enum(LISTING_STATUSES),
  price_cents: z.number().int(),
  updated_at: time,
  provider: z.object({ id, display_name: z.string() }).nullable(),
  category: z.object({ name: z.string() }).nullable(),
  city: z.object({ id, name: z.string() }).nullable(),
});
export const adminListingsPageShape = serverPage(adminListingRowShape);

export const adminProviderRowShape = z.object({
  id,
  display_name: z.string(),
  status: z.enum(["active", "suspended"]),
  created_at: time,
  payout_setup: z.enum(["not_started", "in_progress", "ready"]),
  city: z.object({ name: z.string(), state: z.string() }).nullable(),
});
export const adminProvidersPageShape = serverPage(adminProviderRowShape);

const reviewReport = z.object({
  id, target: z.enum(["review", "reply"]), rule: z.string(), note: z.string().nullable(), created_at: time,
  status: z.string(), resolution_note: z.string().nullable(), from: z.enum(["provider", "someone_else"]),
});
export const adminReviewRowShape = z.object({
  id,
  rating: z.number().int(),
  body: z.string(),
  reviewer_name: z.string(),
  booking_month: z.string(),
  created_at: time,
  edited_at: time.nullable(),
  status: z.enum(["published", "removed"]),
  removed_at: time.nullable(),
  removed_rule: reviewRule.nullable(),
  removed_reason: z.string().nullable(),
  booking_id: id,
  listing: z.object({ id, title: z.string(), slug: z.string(), kind: z.string(), status: z.string() }).nullable(),
  provider: z.object({ id, name: z.string(), slug: z.string() }).nullable(),
  reply: z.object({
    body: z.string(), created_at: time, edited_at: time.nullable(),
    status: z.enum(["published", "removed"]), removed_rule: reviewRule.nullable(), removed_reason: z.string().nullable(),
  }).nullable(),
  reports: z.array(reviewReport),
  provider_removals: count,
  customer_removals: count,
});
export const adminReviewsPageShape = z.object({ total: count, open_reports: count, rows: z.array(adminReviewRowShape) });

export const adminDashboardShape = z.object({
  time_zone: z.string(),
  today: z.string(),
  paid_from: z.string(),
  active_since: z.string(),
  gmv_cents: count,
  commission_cents: count,
  bookings: count,
  active_providers: count,
  listings_to_review: z.object({ experience: count, service: count }),
  open_disputes: count,
  bookings_attention: count,
  guide_drafts: count,
  providers_not_payable: count,
  open_reports: count,
  urgent_reports: count,
});

const supportStatus = z.enum(["todo", "in_progress", "waiting", "done"]);
const supportCategory = z.enum(["booking", "payments", "listing", "website", "safety", "other"]);

/** One column of the admin's problem reports board: its total and one page of cards. */
const supportBoardColumnShape = z.object({
  total: count,
  page: count,
  page_size: count,
  rows: z.array(z.object({
    id,
    category: supportCategory,
    urgent: z.boolean(),
    excerpt: z.string(),
    provider: z.object({ id, name: z.string() }),
    status_changed_at: time,
    last_message_at: time,
    last_message_from: z.enum(["provider", "admin"]),
    created_at: time,
    resolved_at: time.nullable(),
  })),
});

/** The board: every column, or the one asked for ("Show more"). */
export const adminSupportBoardShape = z.object({
  columns: z.object({
    todo: supportBoardColumnShape.optional(),
    in_progress: supportBoardColumnShape.optional(),
    waiting: supportBoardColumnShape.optional(),
    done: supportBoardColumnShape.optional(),
  }),
});

/** AI guide drafts since a time: how many, and their cost (numeric, so a number or a string). */
export const adminAiDraftCostShape = z.object({ count, cost_usd: z.union([z.number(), z.string()]) });

// Support's requests to the owner (admin roles, step 5b).
const adminRequestKind = z.enum(["refund", "release_payout", "resolve_problem_paid", "suspend_provider", "reinstate_provider"]);
const adminRequestStatus = z.enum(["pending", "approved", "declined", "withdrawn", "expired", "done_by_owner"]);

/** One request on the Requests page: what, about what, who asked, how it stands; a refund's amount when asked and now. */
export const adminRequestRowShape = z.object({
  id,
  kind: adminRequestKind,
  resolve_problem: z.boolean(),
  status: adminRequestStatus,
  created_at: time,
  expires_at: time,
  reason: z.string(),
  message: z.string().nullable(),
  hold: z.string().nullable(),
  amount_cents: count.nullable(),
  current_amount_cents: count.nullable(),
  requested_by: id,
  requested_by_email: z.string().nullable(),
  decided_by_email: z.string().nullable(),
  decided_at: time.nullable(),
  decision_note: z.string().nullable(),
  result: z.string().nullable(),
  booking: z.object({
    // starts_at may be missing on an odd booking: one row mustn't break the page.
    id, starts_at: time.nullable(), status: z.string(), payout_hold: z.string().nullable(),
    listing_title: z.string(), provider_name: z.string(), market_name: z.string(), timezone: z.string(),
  }).nullable(),
  provider: z.object({ id, name: z.string(), status: z.string() }).nullable(),
});
export const adminRequestsPageShape = z.object({
  total: count, open_total: count, page: count, page_size: count, rows: z.array(adminRequestRowShape),
});

/** What approving a request runs (the website's approve route). */
export const adminRequestForApprovalShape = z.object({
  id,
  kind: adminRequestKind,
  status: adminRequestStatus,
  booking_id: id.nullable(),
  provider_id: id.nullable(),
  resolve_problem: z.boolean(),
  reason: z.string(),
  message: z.string().nullable(),
  hold: z.string().nullable(),
  amount_cents: count.nullable(),
  current_amount_cents: count.nullable(),
  result: z.string().nullable(),
});

// Contact views and daily limits (admin roles, step 5c).
const used = z.object({ used: count, limit: count });
/** The signed-in admin's use of today's limits (Atlanta day); `limited` is false for the owner. */
export const adminMyLimitsShape = z.object({
  role: z.enum(["owner", "support"]),
  refund_limit_cents: count,
  limited: z.boolean(),
  refunds: used,
  refund_cents: used,
  contact_views: used,
  requests: used,
});
/** A booking's contact details, recorded as viewed. */
export const adminBookingContactShape = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.object({
    line1: z.string(), line2: z.string().nullable(), city: z.string(), state: z.string(), postal_code: z.string(), instructions: z.string().nullable(),
  }).nullable(),
});
/** A provider owner's email, recorded as viewed. */
export const adminProviderContactShape = z.object({ email: z.string().nullable() });
/** The Team page's record of contact views, newest first. */
export const adminContactViewRowShape = z.object({
  id,
  viewed_at: time,
  what: z.enum(["booking_contact", "booking_address", "owner_email"]),
  admin_id: id,
  admin_email: z.string().nullable(),
  booking: z.object({ id, listing_title: z.string(), starts_at: time.nullable(), customer_name: z.string() }).nullable(),
  provider: z.object({ id, name: z.string() }).nullable(),
});
export const adminContactViewsPageShape = z.object({ total: count, page: count, page_size: count, rows: z.array(adminContactViewRowShape) });

/** Every JSON function the apps read, by name: rpcJson and the check use this list. */
export const adminActivityRowShape = z.object({
  id,
  admin_id: id.nullable(),
  admin_email: z.string().nullable(),
  target: z.string(),
  target_id: id.nullable(),
  action: z.string(),
  reason: z.string().nullable(),
  message: z.string().nullable(),
  amount_cents: count.nullable(),
  request_id: id.nullable(),
  created_at: time,
});
export const adminActivityPageShape = z.object({ total: count, rows: z.array(adminActivityRowShape) });

export const adminProfileHoldRowShape = z.object({
  id,
  part: z.enum(["avatar", "cover", "headline", "bio"]),
  rule: z.string(),
  reason: z.string(),
  message: z.string().nullable(),
  hidden_at: time,
  overdue: z.boolean(),
  status: z.enum(["hidden", "removed", "restored", "dismissed"]),
  files: z.enum(["none", "moving", "private", "missing", "restoring", "public", "deleting", "deleted"]),
  held_text: z.string().nullable(),
  held_paths: z.array(z.string()).nullable(),
  public_paths: z.array(z.string()).nullable(),
  decided_at: time.nullable(),
  hidden_by_email: z.string().nullable(),
  decided_by_email: z.string().nullable(),
  slot_filled: z.boolean(),
  provider: z.object({ id, name: z.string(), slug: z.string() }),
});
export const adminProfileHoldsPageShape = z.object({ total: count, rows: z.array(adminProfileHoldRowShape) });
/** admin_hide_profile_content: each hidden photo's files, to move into the private bucket. */
export const adminHideProfileContentShape = z.array(z.object({ hold_id: id, from: z.array(z.string()), to: z.array(z.string()) }));
/** admin_decide_profile_hold: the files to move back or delete, or null when there are none. */
export const adminDecideProfileHoldShape = z.object({
  hold_id: id,
  move_back: z.boolean().optional(),
  delete: z.boolean().optional(),
  bucket: z.string().optional(),
  from: z.array(z.string()).optional(),
  to: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
}).nullable();
export const myProfileHoldsShape = z.array(z.object({ part: z.enum(["avatar", "cover", "headline", "bio"]), rule: z.string(), hidden_at: time }));

export const RPC_SHAPES = {
  admin_profile_holds_page: adminProfileHoldsPageShape,
  admin_hide_profile_content: adminHideProfileContentShape,
  admin_decide_profile_hold: adminDecideProfileHoldShape,
  my_profile_holds: myProfileHoldsShape,
  admin_activity_page: adminActivityPageShape,
  listing_readiness: listingReadinessShape,
  admin_ai_draft_cost: adminAiDraftCostShape,
  admin_booking_contact: adminBookingContactShape,
  admin_bookings_page: adminBookingsPageShape,
  admin_contact_views_page: adminContactViewsPageShape,
  admin_dashboard: adminDashboardShape,
  admin_listings_page: adminListingsPageShape,
  admin_my_limits: adminMyLimitsShape,
  admin_provider_contact: adminProviderContactShape,
  admin_providers_page: adminProvidersPageShape,
  admin_request_for_approval: adminRequestForApprovalShape,
  admin_requests_page: adminRequestsPageShape,
  admin_reviews_page: adminReviewsPageShape,
  admin_support_board: adminSupportBoardShape,
  listing_sessions_page: listingSessionsPageShape,
  my_saved: mySavedShape,
  my_support_reports: mySupportReportsShape,
  public_browse: publicBrowseShape,
  public_category_counts: publicCategoryCountsShape,
  public_guide: publicGuideShape,
  public_guides: publicGuidesShape,
  public_homepage_guides: publicHomepageGuidesShape,
  refresh_stale_service_open_days: refreshStaleServiceOpenDaysShape,
  review_state: reviewStateShape,
} as const;
export type RpcJsonName = keyof typeof RPC_SHAPES;
export type RpcJson<N extends RpcJsonName> = z.infer<(typeof RPC_SHAPES)[N]>;

export type AdminBookingRow = z.infer<typeof adminBookingRowShape>;
export type AdminActivityRow = z.infer<typeof adminActivityRowShape>;
export type AdminProfileHoldRow = z.infer<typeof adminProfileHoldRowShape>;
export type AdminRequestRow = z.infer<typeof adminRequestRowShape>;
export type AdminMyLimits = z.infer<typeof adminMyLimitsShape>;
export type AdminContactViewRow = z.infer<typeof adminContactViewRowShape>;
export type AdminListingRow = z.infer<typeof adminListingRowShape>;
export type AdminProviderRow = z.infer<typeof adminProviderRowShape>;
export type AdminReviewRow = z.infer<typeof adminReviewRowShape>;
export type AdminDashboard = z.infer<typeof adminDashboardShape>;
export type ListingSessionsPage = z.infer<typeof listingSessionsPageShape>;
export type ListingSessionRow = ListingSessionsPage["items"][number];
export type MySavedRows = z.infer<typeof mySavedShape>;
export type ReviewState = NonNullable<z.infer<typeof reviewStateShape>>;
export type MySupportReports = z.infer<typeof mySupportReportsShape>;
export type MySupportReportRow = MySupportReports["rows"][number];
export type AdminSupportBoard = z.infer<typeof adminSupportBoardShape>;
export type AdminSupportColumn = NonNullable<AdminSupportBoard["columns"]["todo"]>;
export type AdminSupportCard = AdminSupportColumn["rows"][number];
