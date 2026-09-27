// Turns a name into a URL-safe slug: "Hair & Beauty" -> "hair-beauty".
// Matches the slug rule in the database and in packages/types.
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
