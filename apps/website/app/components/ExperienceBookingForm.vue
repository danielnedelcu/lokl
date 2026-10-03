<script setup lang="ts">
import { z } from "zod";
import type { PublicListing } from "@repo/types";

// Book an Experience: a date (session), how many people, then Stripe
// Checkout, which charges at once (docs/design/booking-and-checkout.md).
// The route checks everything again, including spots, with the session
// locked, so the last spot can't go twice.
const props = defineProps<{ listing: PublicListing }>();
const tz = computed(() => props.listing.market.timezone);

const timeRange = (startsAt: string) => {
  const start = formatSessionTime(startsAt, tz.value);
  if (!props.listing.durationMinutes) return start;
  return `${start} – ${formatSessionTime(new Date(Date.parse(startsAt) + props.listing.durationMinutes * 60_000).toISOString(), tz.value)}`;
};
const spotsText = (n: number) => (n <= 0 ? "Full" : n === 1 ? "1 spot left" : `${n} spots left`);

const schema = z.object({
  sessionId: z.string({ message: "Choose a date." }).min(1, "Choose a date."),
  partySize: z.coerce.number({ message: "Enter how many people." }).int().min(1, "Book at least 1 spot.").max(10, "Book up to 10 people at a time."),
  name: z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters."),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(1000, "Keep your notes under 1,000 characters.").optional(),
});
const { handleSubmit, values, setFieldValue, setFieldError } = useForm<z.input<typeof schema>>({
  validationSchema: zodSchema(schema),
  initialValues: { sessionId: "", partySize: 1, name: "", phone: "", notes: "" },
});
const { errorMessage: sessionError } = useField<string>("sessionId");
onMounted(async () => {
  const name = await lastBookingName();
  if (name && !values.name) setFieldValue("name", name);
});

const chosen = computed(() => props.listing.sessions.find((s) => s.id === values.sessionId));
const maxPeople = computed(() => Math.min(10, chosen.value?.spotsLeft ?? 10));
const total = computed(() => {
  const n = Number(values.partySize) || 1;
  return `${n} × ${formatMoney(props.listing.priceCents, props.listing.currency)} = ${formatMoney(props.listing.priceCents * n, props.listing.currency)}`;
});

const { sending, problem, start } = useBookingCheckout();
const submit = handleSubmit(async (v) => {
  if (chosen.value && Number(v.partySize) > chosen.value.spotsLeft) {
    return setFieldError("partySize", `Only ${spotsText(chosen.value.spotsLeft).replace(" left", "")} left on that date.`);
  }
  const ok = await start("/api/bookings/experience", {
    sessionId: v.sessionId, partySize: Number(v.partySize), name: v.name, phone: v.phone || undefined, notes: v.notes || undefined,
  });
  // Spots may have changed while they filled the form: show the latest.
  if (!ok) await refreshNuxtData();
});
</script>

<template>
  <p v-if="!listing.sessions.length" class="text-sm">No dates are open right now. Check back soon.</p>
  <form v-else class="space-y-5" novalidate @submit="submit">
    <fieldset>
      <legend class="mb-2 text-sm font-medium">Choose a date <span class="text-destructive">*</span></legend>
      <p class="text-muted-foreground mb-2 text-xs">Times are {{ timeZoneLabel(listing.market.name, tz) }}.</p>
      <UiRadioGroup :model-value="values.sessionId" class="max-h-72 gap-2 overflow-y-auto p-0.5"
        :aria-describedby="sessionError ? 'session-error' : undefined" :aria-invalid="!!sessionError || undefined"
        @update:model-value="(v) => setFieldValue('sessionId', String(v))">
        <label v-for="s in listing.sessions" :key="s.id"
          class="border-border has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-primary/30 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 has-[[data-state=checked]]:ring-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
          <UiRadioGroupItem :value="s.id" :disabled="s.spotsLeft <= 0" />
          <span class="flex-1">
            <span class="block text-sm font-medium">{{ formatSessionDate(s.startsAt, tz) }}</span>
            <span class="text-muted-foreground block text-xs">{{ timeRange(s.startsAt) }}</span>
          </span>
          <span class="text-xs" :class="s.spotsLeft <= 0 ? 'text-muted-foreground' : ''">{{ spotsText(s.spotsLeft) }}</span>
        </label>
      </UiRadioGroup>
      <p v-if="sessionError" id="session-error" class="text-destructive mt-1 text-sm">{{ sessionError }}</p>
    </fieldset>

    <UiVeeNumberField name="partySize" :min="1" :max="maxPeople" label="How many people?" required touch
      :hint="chosen ? `Up to ${maxPeople} on this date.` : 'Up to 10 at a time.'" />
    <p class="text-sm" aria-live="polite"><span class="text-muted-foreground">Total:</span> <span class="font-medium">{{ total }}</span></p>

    <UiVeeInput name="name" label="Your name" required autocomplete="name" />
    <UiVeeInput name="phone" type="tel" label="Phone (optional)" autocomplete="tel" hint="Shared with the host once you're booked." />
    <UiVeeTextarea name="notes" label="Notes for the host (optional)" :rows="3" maxlength="1000"
      hint="For example, dietary needs or accessibility." />

    <p v-if="problem" class="text-destructive text-sm" role="alert">{{ problem }}</p>
    <UiButton type="submit" class="w-full" :disabled="sending">{{ sending ? "Opening checkout…" : "Continue to payment" }}</UiButton>
  </form>
</template>
