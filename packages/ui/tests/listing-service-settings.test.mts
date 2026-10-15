// A Service's booking settings in the listing form (docs/design/
// service-availability.md, phase 2): a mode is required (no default), the
// duration is required and 15 to 720 minutes, and the buffer is empty (the
// provider's default) or 0 to 120 minutes. Experiences need none of it.
// Run: npx tsx packages/ui/tests/listing-service-settings.test.mts (part of `npm run test:ui`).
import { listingSchema } from "../../types/src/listings";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const ID = "0b8a2c1e-4f5d-4e6a-9b7c-1d2e3f4a5b6c";
const service = {
  kind: "service", category_id: ID, city_id: ID, title: "Studio haircut", description: "A classic cut, with a wash and a style.",
  price_cents: 4500, duration_minutes: 60, location_mode: "provider_location", area_id: ID, address: { line1: "1 Main St", city: "Atlanta", state: "GA", postal_code: "30312" },
  booking_mode: "approve", buffer_minutes: "",
};
const errorsOf = (v: object) => {
  const r = listingSchema.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

check(Object.keys(errorsOf(service)).length === 0, "1. a Service with a mode, 60 minutes and the default buffer is valid");
check(errorsOf({ ...service, booking_mode: null }).booking_mode === "Choose how customers book this Service.", "2a. no mode: \"Choose how customers book this Service.\"");
check(errorsOf({ ...service, booking_mode: undefined }).booking_mode === "Choose how customers book this Service.", "2b. ...nor when it was never chosen");
check(Object.keys(errorsOf({ ...service, booking_mode: "instant" })).length === 0, "2c. Instant is a choice");
check(errorsOf({ ...service, duration_minutes: "" }).duration_minutes === "Enter how long the Service takes.", "3a. no duration: \"Enter how long the Service takes.\"");
check(errorsOf({ ...service, duration_minutes: 10 }).duration_minutes === "Enter 15 to 720 minutes (up to 12 hours) for a Service.", "3b. 10 minutes is too short");
check(errorsOf({ ...service, duration_minutes: 800 }).duration_minutes === "Enter 15 to 720 minutes (up to 12 hours) for a Service.", "3c. 800 minutes is too long");
check(Object.keys(errorsOf({ ...service, duration_minutes: 15 })).length === 0 && Object.keys(errorsOf({ ...service, duration_minutes: 720 })).length === 0, "3d. 15 and 720 are allowed");
check(listingSchema.safeParse({ ...service, buffer_minutes: "" }).data?.buffer_minutes === null, "4a. an empty buffer means the provider's default (null)");
check(Object.keys(errorsOf({ ...service, buffer_minutes: 30 })).length === 0, "4b. 30 minutes is a buffer");
check(errorsOf({ ...service, buffer_minutes: 150 }).buffer_minutes === "Enter at most 120 minutes (2 hours).", "4c. 150 minutes is too much");
const experience = { ...service, kind: "experience", location_mode: null, booking_mode: null, buffer_minutes: null, duration_minutes: 10 };
check(Object.keys(errorsOf(experience)).length === 0, "5. an Experience needs no mode, and keeps its own duration rule (10 minutes is fine)");

console.log(failures ? `${failures} failed` : "All listing service settings checks passed.");
process.exit(failures ? 1 : 0);
