import { z } from "zod";

// What the booking forms send (docs/design/booking-and-checkout.md). The
// database checks the same rules again (create_service_request,
// reserve_experience_booking); these give the customer plain messages first.

const name = z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters.");
const phone = z
  .string()
  .trim()
  .max(30, "Keep the phone number under 30 characters.")
  .refine((v) => v === "" || /^[0-9+()\-.\s]{7,30}$/.test(v), "Enter a phone number, or leave it empty.")
  .optional();
const notes = z.string().trim().max(1000, "Keep your notes under 1,000 characters.").optional();

export const bookingAddressSchema = z.object({
  line1: z.string().trim().min(3, "Enter the street address.").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "Enter the city.").max(80),
  state: z.string().trim().regex(/^[A-Z]{2}$/, "Use the two-letter state, like GA."),
  postal_code: z.string().trim().regex(/^[0-9]{5}(-[0-9]{4})?$/, "Enter a five-digit zip code."),
  instructions: z.string().trim().max(500).optional(),
});

export const serviceBookingRequestSchema = z.object({
  listingId: z.uuid(),
  preferredTimes: z
    .array(z.iso.datetime({ offset: true }))
    .min(1, "Choose at least one time.")
    .max(3, "Choose up to three times.")
    .refine((t) => new Set(t).size === t.length, "Choose different times."),
  name,
  phone,
  notes,
  address: bookingAddressSchema.optional(),
});
export type ServiceBookingRequest = z.infer<typeof serviceBookingRequestSchema>;

export const experienceBookingRequestSchema = z.object({
  sessionId: z.uuid(),
  partySize: z.coerce.number().int().min(1, "Book at least 1 spot.").max(10, "Book up to 10 people at a time."),
  name,
  phone,
  notes,
});
export type ExperienceBookingRequest = z.infer<typeof experienceBookingRequestSchema>;
