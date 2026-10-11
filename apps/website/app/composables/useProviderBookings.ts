import { marketZone } from "@repo/types";
// The provider's bookings, as /api/provider/bookings returns them, and the
// small wording helpers the bookings pages share.

export interface ProviderBookingAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  instructions: string | null;
}

export interface ProviderBooking {
  id: string;
  kind: "service" | "experience";
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  preferred_times: string[] | null;
  party_size: number;
  total_cents: number;
  provider_amount_cents: number;
  respond_by: string | null;
  customer_name: string;
  customer_notes: string | null;
  customer_city: string | null;
  customer_postal_code: string | null;
  cancelled_by: string | null;
  listing: { title: string; location_mode: string | null; duration_minutes: number | null; city: { name: string; timezone: string } | null } | null;
  /** Only once accepted or confirmed (RLS); null before. */
  contact: { email: string; phone: string | null } | null;
  /** "I come to you" Services, once accepted (RLS); null before. */
  address: ProviderBookingAddress | null;
}

export type ProviderBookingTab = "requests" | "upcoming" | "past";

/** One page of one tab, with every tab's count (the route pages in the database). */
export interface ProviderBookingsPage {
  tab: ProviderBookingTab;
  items: ProviderBooking[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<ProviderBookingTab, number>;
}

/** The first page of a tab; it reloads when the tab changes. */
export function useProviderBookings(tab: Ref<ProviderBookingTab>) {
  return useFetch<ProviderBookingsPage>("/api/provider/bookings", {
    key: "provider-bookings",
    query: computed(() => ({ tab: tab.value, page: 1 })),
    headers: useRequestHeaders(["cookie"]),
  });
}

/** A later page of a tab ("Show more bookings"). */
export const fetchProviderBookingsPage = (tab: ProviderBookingTab, page: number) =>
  $fetch<ProviderBookingsPage>("/api/provider/bookings", { query: { tab, page } });

export const bookingZone = (b: Pick<ProviderBooking, "listing">) => marketZone(b.listing?.city, "a provider's booking");

/** "Thu, Oct 9, 2:00 PM". */
export const bookingAt = (instant: string, timeZone: string) =>
  `${formatSessionDate(instant, timeZone)}, ${formatSessionTime(instant, timeZone)}`;

/** "Thu, Oct 9, 2:00 PM – 3:00 PM", or just the start. */
export function bookingRange(b: Pick<ProviderBooking, "starts_at" | "ends_at" | "listing">) {
  if (!b.starts_at) return "";
  const tz = bookingZone(b);
  const end = b.ends_at && b.ends_at !== b.starts_at ? ` – ${formatSessionTime(b.ends_at, tz)}` : "";
  return `${bookingAt(b.starts_at, tz)}${end}`;
}

/** "31 hours left", "45 minutes left", or "No time left". */
export function timeLeft(until: string, now = Date.now()) {
  const minutes = Math.floor((Date.parse(until) - now) / 60_000);
  if (minutes <= 0) return "No time left";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
}

/** Roughly where an "I come to you" Service is, before the street address is shared. */
export const customerArea = (b: Pick<ProviderBooking, "customer_city" | "customer_postal_code">) =>
  b.customer_city ? `${b.customer_city} ${b.customer_postal_code ?? ""}`.trim() : null;
