import { z } from "zod";
import { contactDetailsMessage } from "./providers";

// Schemas shared by a page's form and the server route it posts to, so both
// validate the same way. The route always validates again (docs/frontend.md).
// Messages say how to fix the problem, in plain words.

export const providerProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Enter your business or host name (at least 2 characters).")
    .max(120, "Keep the name under 120 characters."),
  city_id: z.uuid("Choose your metro area from the list."),
  // The public profile (docs/design/provider-profiles.md): no contact
  // details, and the message says what the text looks like.
  headline: profileText(80, "Keep the headline under 80 characters."),
  bio: profileText(1000, "Keep it under 1,000 characters."),
});
export type ProviderProfileInput = z.input<typeof providerProfileSchema>;

function profileText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .superRefine((text, ctx) => {
      const problem = contactDetailsMessage(text);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .optional()
    .default("");
}

export const signInSchema = z.object({
  email: z.email("Enter your email address, like name@example.com."),
});
export type SignInInput = z.input<typeof signInSchema>;

// ---------------------------------------------------------------------------
// Admin reference lists (written from the admin app under admin-only rules)
// ---------------------------------------------------------------------------

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, like hair-and-beauty.");

export const CATEGORY_KINDS = ["service", "experience"] as const;

export const categorySchema = z.object({
  kind: z.enum(CATEGORY_KINDS, "Choose Services or Experiences."),
  name: z
    .string()
    .trim()
    .min(2, "Enter a category name (at least 2 characters).")
    .max(60, "Keep the name under 60 characters."),
  slug,
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .optional()
    .transform((v) => v || null),
});
export type CategoryInput = z.input<typeof categorySchema>;

// US time zones lokl can operate in, with plain-language labels. The value is
// the IANA name stored in cities.timezone.
export const US_TIME_ZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

export const citySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the market's name (at least 2 characters).")
    .max(80, "Keep the name under 80 characters."),
  slug,
  state: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Enter the two-letter state code, like GA.")),
  timezone: z.enum(
    US_TIME_ZONES.map((t) => t.value) as [string, ...string[]],
    "Choose the market's time zone.",
  ),
});
export type CityInput = z.input<typeof citySchema>;

// Areas inside a market: a neighborhood, a city or town within the metro
// (like Decatur in the Atlanta market), or a zip code.
export const SERVICE_AREA_KINDS = ["neighborhood", "city", "zip"] as const;

export const serviceAreaSchema = z
  .object({
    kind: z.enum(SERVICE_AREA_KINDS, "Choose neighborhood, city or town, or zip code."),
    name: z.string().trim().min(1, "Enter the area's name or zip code.").max(80, "Keep the name under 80 characters."),
  })
  .refine((a) => a.kind !== "zip" || /^[0-9]{5}$/.test(a.name), {
    path: ["name"],
    message: "Enter a five-digit zip code, like 30312.",
  });
export type ServiceAreaInput = z.input<typeof serviceAreaSchema>;
