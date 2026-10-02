// What public pages receive (docs/design/browse-and-listing-pages.md). The
// shapes come from apps/website/server/utils/publicListings.ts, which reads
// as a signed-out visitor, so nothing here is ever private: no address, and
// nothing about the provider beyond the business name.

import type { ListingKind, LocationMode } from "./listings";

export type AreaKind = "neighborhood" | "city" | "zip";

export interface PublicArea {
  name: string;
  kind: AreaKind;
}

export interface PublicMarket {
  name: string;
  slug: string;
  state: string;
  timezone: string;
}

export interface PublicPhoto {
  path: string;
  /** The ~600px copy for cards; null for older photos (use `path`). */
  cardPath: string | null;
  alt: string;
}

export interface PublicListingCard {
  id: string;
  kind: ListingKind;
  slug: string;
  title: string;
  priceCents: number;
  currency: string;
  durationMinutes: number | null;
  category: { name: string; slug: string };
  /** The listing's own area; null for "I come to you" Services. */
  area: PublicArea | null;
  /** Where an "I come to you" Service travels; empty otherwise. */
  travelAreas: PublicArea[];
  cover: PublicPhoto | null;
  /** Experiences: the next scheduled session, or null. */
  nextSessionAt: string | null;
}

export interface PublicListing extends PublicListingCard {
  description: string;
  locationMode: LocationMode | null;
  market: PublicMarket;
  hostedBy: string;
  /** Public: lets the page tell a provider "this is your listing". */
  providerId: string;
  photos: PublicPhoto[];
  /** Experiences: upcoming scheduled sessions, soonest first, with spots left. */
  sessions: { id: string; startsAt: string; spotsLeft: number }[];
}

export interface PublicBrowseResult {
  market: PublicMarket;
  kind: ListingKind;
  items: PublicListingCard[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicMarketInfo {
  market: PublicMarket;
  /** Active categories of each kind, with how many visible listings each has. */
  categories: { kind: ListingKind; name: string; slug: string; description: string | null; count: number }[];
  /** Active areas in the market, for the area filter. */
  areas: (PublicArea & { id: string })[];
}

/**
 * How an area reads on a page: a neighbourhood or zip with its market
 * ("Old Fourth Ward, Atlanta"), a city or town on its own ("Decatur"), since
 * "Decatur, Atlanta" would be wrong (docs/decisions.md, 2026-09-30).
 */
export function areaLabel(area: PublicArea, marketName: string): string {
  return area.kind === "city" ? area.name : `${area.name}, ${marketName}`;
}

/** Where a listing is, in one line: its area, or where it travels. */
export function whereLabel(listing: Pick<PublicListingCard, "area" | "travelAreas">, marketName: string): string {
  if (listing.area) return areaLabel(listing.area, marketName);
  const names = listing.travelAreas.map((a) => a.name);
  if (!names.length) return `Comes to you in ${marketName}`;
  if (names.length === 1) return `Comes to you in ${names[0]}`;
  return `Comes to you in ${names[0]} and ${names.length - 1} more`;
}
