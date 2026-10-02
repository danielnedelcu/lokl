<script setup lang="ts">
import { z } from "zod";
import type { PublicListing } from "@repo/types";

// Request a Service: up to three preferred times (the provider accepts one),
// the address for "I come to you", then Stripe Checkout, which holds the card
// until they accept (docs/design/booking-and-checkout.md).
const props = defineProps<{ listing: PublicListing }>();
const tz = computed(() => props.listing.market.timezone);
const comesToYou = computed(() => props.listing.locationMode === "customer_location");
const earliest = computed(() => addDays(todayIn(tz.value), 1));
const maxDate = computed(() => addDays(todayIn(tz.value), 365));

const DAY_MS = 24 * 60 * 60 * 1000;
const slot = z.object({ date: z.string().min(1, "Choose a date."), time: z.string().min(1, "Choose a time.") });
const schema = z
  .object({
    times: z.array(slot).min(1).max(3),
    name: z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters."),
    phone: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(1000, "Keep your notes under 1,000 characters.").optional(),
    line1: z.string().trim().optional(),
    line2: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    postal_code: z.string().trim().optional(),
    instructions: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.times.forEach((t, i) => {
      if (!t.date || !t.time) return;
      const at = zonedToInstant(t, props.listing.market.timezone);
      if (Date.parse(at) < Date.now() + DAY_MS) {
        ctx.addIssue({ code: "custom", path: ["times", i, "time"], message: "Choose a time at least 24 hours from now." });
      }
      if (seen.has(at)) ctx.addIssue({ code: "custom", path: ["times", i, "time"], message: "You've already offered this time." });
      seen.add(at);
    });
    if (props.listing.locationMode === "customer_location") {
      if (!v.line1 || v.line1.length < 3) ctx.addIssue({ code: "custom", path: ["line1"], message: "Enter the street address." });
      if (!v.city || v.city.length < 2) ctx.addIssue({ code: "custom", path: ["city"], message: "Enter the city." });
      if (!/^[A-Z]{2}$/.test(v.state ?? "")) ctx.addIssue({ code: "custom", path: ["state"], message: "Use the two-letter state, like GA." });
      if (!/^[0-9]{5}(-[0-9]{4})?$/.test(v.postal_code ?? "")) ctx.addIssue({ code: "custom", path: ["postal_code"], message: "Enter a five-digit zip code." });
    }
  });
type Form = z.input<typeof schema>;
const { handleSubmit, values, setFieldValue } = useForm<Form>({
  validationSchema: zodSchema(schema),
  initialValues: { times: [{ date: "", time: "" }], name: "", phone: "", notes: "", line1: "", line2: "", city: "", state: "GA", postal_code: "", instructions: "" },
});
const { fields: times, push, remove } = useFieldArray<{ date: string; time: string }>("times");
onMounted(async () => {
  const name = await lastBookingName();
  if (name && !values.name) setFieldValue("name", name);
});

const { sending, problem, start } = useBookingCheckout();
const submit = handleSubmit((v) =>
  start("/api/bookings/service", {
    listingId: props.listing.id,
    preferredTimes: v.times.map((t) => zonedToInstant(t, tz.value)),
    name: v.name,
    phone: v.phone || undefined,
    notes: v.notes || undefined,
    address: comesToYou.value
      ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, postal_code: v.postal_code, instructions: v.instructions || undefined }
      : undefined,
  }),
);
</script>

<template>
  <form class="space-y-5" novalidate @submit="submit">
    <fieldset class="space-y-3">
      <legend class="text-sm font-medium">When would you like it? <span class="text-destructive">*</span></legend>
      <p class="text-muted-foreground text-xs">
        Offer up to three times, at least 24 hours from now. The provider accepts one. Times are
        {{ timeZoneLabel(listing.market.name, tz) }}.
      </p>
      <div v-for="(t, i) in times" :key="t.key" class="border-border space-y-3 rounded-md border p-3">
        <div class="flex items-center justify-between">
          <p class="text-sm font-medium">{{ i === 0 ? "First choice" : i === 1 ? "Second choice" : "Third choice" }}</p>
          <UiButton v-if="times.length > 1" type="button" variant="link" size="sm" class="h-auto px-0"
            :aria-label="`Remove the ${i === 1 ? 'second' : i === 2 ? 'third' : 'first'} choice`" @click="remove(i)">
            Remove
          </UiButton>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UiVeeInput :name="`times[${i}].date`" type="date" label="Date" required :min="earliest" :max="maxDate" />
          <UiVeeInput :name="`times[${i}].time`" type="time" label="Time" required step="900" />
        </div>
      </div>
      <UiButton v-if="times.length < 3" type="button" variant="outline" class="w-full" @click="push({ date: '', time: '' })">
        Add another time
      </UiButton>
    </fieldset>

    <fieldset v-if="comesToYou" class="space-y-3">
      <legend class="text-sm font-medium">Where should they come?</legend>
      <p v-if="listing.travelAreas.length" class="text-muted-foreground text-xs">
        They travel to: {{ listing.travelAreas.map((a) => a.name).join(", ") }}.
      </p>
      <UiVeeInput name="line1" label="Street address" required autocomplete="address-line1" />
      <UiVeeInput name="line2" label="Apartment or suite (optional)" autocomplete="address-line2" />
      <div class="grid grid-cols-[1fr_5rem] gap-3">
        <UiVeeInput name="city" label="City" required autocomplete="address-level2" />
        <UiVeeInput name="state" label="State" required maxlength="2" autocomplete="address-level1" />
      </div>
      <UiVeeInput name="postal_code" label="Zip code" required inputmode="numeric" autocomplete="postal-code" />
      <UiVeeTextarea name="instructions" label="Access notes (optional)" :rows="2" maxlength="500"
        hint="Shared once they accept. For example, the gate code." />
    </fieldset>

    <UiVeeInput name="name" label="Your name" required autocomplete="name" />
    <UiVeeInput name="phone" type="tel" label="Phone (optional)" autocomplete="tel" hint="Shared with the provider once they accept." />
    <UiVeeTextarea name="notes" label="Notes for the provider (optional)" :rows="3" maxlength="1000"
      hint="What you'd like, or anything they should know." />

    <p v-if="problem" class="text-destructive text-sm" role="alert">{{ problem }}</p>
    <UiButton type="submit" class="w-full" :disabled="sending">{{ sending ? "Opening checkout…" : "Continue to payment" }}</UiButton>
  </form>
</template>
