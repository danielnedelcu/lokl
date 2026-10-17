// Problem reports (docs/design/problem-reports.md): their categories and
// statuses in words, shared by the provider's pages, the admin's board and
// the bell, and the limits' messages the database raises.

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
