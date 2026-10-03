// A guide's web address before it's chosen (decided 2026-10-03). "New guide"
// creates the guide straight away with a placeholder address; until the
// guide is first published, the address follows the title unless the admin
// types one by hand.

/** Placeholder addresses start with this; the rest is random. */
export const NEW_GUIDE_SLUG_PREFIX = "new-guide-";

export function newGuideSlug() {
  return NEW_GUIDE_SLUG_PREFIX + crypto.randomUUID().slice(0, 8);
}

/** The address a title suggests: lowercase words joined by hyphens, at most 80 characters. */
export function titleSlug(title: string) {
  return slugify(title).slice(0, 80).replace(/-+$/, "");
}
