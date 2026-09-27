import { z } from "zod";

// Schemas shared by a page's form and the server route it posts to, so both
// validate the same way. The route always validates again (docs/frontend.md).
// Messages say how to fix the problem, in plain words.

export const providerProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Enter your business or host name (at least 2 characters).")
    .max(120, "Keep the name under 120 characters."),
  city_id: z.uuid("Choose your city from the list."),
});
export type ProviderProfileInput = z.input<typeof providerProfileSchema>;

export const signInSchema = z.object({
  email: z.email("Enter your email address, like name@example.com."),
});
export type SignInInput = z.input<typeof signInSchema>;
