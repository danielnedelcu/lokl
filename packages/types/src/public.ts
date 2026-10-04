// What public pages receive (docs/design/browse-and-listing-pages.md). The
// shapes come from apps/website/server/utils/publicListings.ts, which reads
// as a signed-out visitor, so nothing here is ever private: no address, and
// about the provider only their public profile
// (docs/design/provider-profiles.md).

import type { ListingKind, LocationMode } from "./listings";
import type { RatingSummary } from "./reviews";

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
  /** Whose listing it is (the heart is hidden on a provider's own). */
  providerId: string;
  /** Its published reviews' count and average (docs/design/reviews.md); kept by the database. */
  rating: RatingSummary;
}

/** A provider's public profile: what signed-out visitors may read. */
export interface PublicProvider {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  bio: string | null;
  avatarPath: string | null;
  avatarSmallPath: string | null;
  coverPath: string | null;
  coverCardPath: string | null;
  /** Their market's name: "Based in Atlanta". */
  market: string | null;
  /** When they joined: "On lokl since October 2026". */
  since: string;
  /** Their published reviews across all their listings: count and average. */
  rating: RatingSummary;
}

/** The profile page: the provider and all their visible listings, newest first. */
export interface PublicProviderPage {
  provider: PublicProvider;
  /** The provider's reviews at each star level, for the breakdown. */
  stars: StarCounts;
  /** The provider's market (for times on their listing cards). */
  market: PublicMarket | null;
  experiences: PublicListingCard[];
  services: PublicListingCard[];
}

/** Reviews at each star level, 1 to 5, for the breakdown. */
export type StarCounts = [number, number, number, number, number];

/** A published review on a public page (docs/design/reviews.md). */
export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  /** "Sam T.", made by the database from the booking's name. */
  reviewerName: string;
  /** yyyy-mm-01: "Booked October 2026". */
  bookingMonth: string;
  createdAt: string;
  editedAt: string | null;
  /** The listing it's for (on the profile page); null when no longer live. */
  listing: { title: string; slug: string; kind: ListingKind } | null;
  reply: { body: string; createdAt: string; editedAt: string | null } | null;
}

/** A page of a listing's or provider's reviews, newest first. */
export interface PublicReviewPage {
  items: PublicReview[];
  total: number;
  page: number;
  pageSize: number;
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
  /** The provider's public profile, for the card on the listing page. */
  provider: PublicProvider | null;
  /** Up to three of the provider's other visible listings, and how many there are. */
  moreFromProvider: { items: PublicListingCard[]; total: number };
  /** This listing's reviews at each star level, for the breakdown. */
  stars: StarCounts;
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

/**
 * The signed-in customer's Saved page (docs/design/favourites.md), newest
 * saved first. An available item comes with what a visitor would see; an
 * unavailable one with only its name, and not even that when lokl took it
 * down or suspended its provider (null).
 */
export interface MySaved {
  listings: {
    id: string;
    savedAt: string;
    /** The listing card, with its market; null when no longer available. */
    card: (PublicListingCard & { market: PublicMarket }) | null;
    title: string | null;
  }[];
  providers: {
    id: string;
    savedAt: string;
    /** The provider's profile; null when no longer available. */
    provider: PublicProvider | null;
    name: string | null;
  }[];
}
