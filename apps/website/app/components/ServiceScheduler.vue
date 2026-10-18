<script setup lang="ts">
import { z } from "zod";
import { SLOT_TAKEN, beginCheckoutEvent, type PublicListing } from "@repo/types";

// Book a Service from its free times (docs/design/service-availability.md,
// "The customer's scheduling panel"): a dialog with a week of days and the
// chosen day's times (service_slots, live), then the customer's details,
// then Stripe Checkout. Instant Services are charged at once; for the rest
// the card is held until the provider accepts. Every day and time is the
// market's, and says so. The database checks the slot again when booking,
// so a time taken meanwhile is refused and the times reload.
const props = defineProps<{ listing: PublicListing; nextSlotAt: string }>();
const supabase = useSupabaseClient();

const tz = computed(() => props.listing.market.timezone);
const zone = computed(() => timeZoneLabel(props.listing.market.name, tz.value));
const marketTime = computed(() => `${props.listing.market.name} time`);
const instant = computed(() => props.listing.bookingMode === "instant");
const comesToYou = computed(() => props.listing.locationMode === "customer_location");
const price = computed(() => formatMoney(props.listing.priceCents, props.listing.currency));
const today = todayIn(props.listing.market.timezone);
const nextLabel = computed(() => `${formatSessionDate(props.nextSlotAt, tz.value)}, ${formatSessionTime(props.nextSlotAt, tz.value)} (${marketTime.value})`);

const open = ref(false);
const step = ref<"time" | "details">("time");

// ---- The week and its times ------------------------------------------------
type Slot = { starts_at: string; ends_at: string };
// From dated search results (?date=YYYY-MM-DD, the first searched day with a
// free time): start on that day, and open at once (signed out, once signed
// in, since this panel only shows then). Otherwise the next free day.
const route = useRoute();
const asked = typeof route.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) && route.query.date >= today
  ? route.query.date : null;
const firstDay = asked ?? instantToZoned(props.nextSlotAt, props.listing.market.timezone).date;
const day = ref(firstDay);
const weekStart = ref(weekStartOf(firstDay));
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)));
const weekLabel = computed(() => formatDateRange(days.value[0]!, days.value[6]!));
const canGoBack = computed(() => weekStart.value > weekStartOf(today));

const slots = ref<Slot[]>([]);
const status = ref<"idle" | "pending" | "success" | "error">("idle");
let loads = 0;
async function load() {
  const mine = ++loads;
  status.value = "pending";
  const { data, error } = await supabase.rpc("service_slots", {
    p_listing_id: props.listing.id, p_from: days.value[0]!, p_to: days.value[6]!,
  });
  if (mine !== loads) return; // a later week was asked for meanwhile
  if (error) {
    status.value = "error";
    return;
  }
  slots.value = (data ?? []) as Slot[];
  status.value = "success";
  // Keep the chosen day if it has times; otherwise the week's first that does.
  if (!timesOn(day.value).length) day.value = byDay.value.find((d) => d.times.length)?.day ?? days.value[0]!;
}
watch([open, weekStart], ([isOpen]) => {
  if (isOpen) load();
});

const timesOn = (d: string) => slots.value.filter((s) => instantToZoned(s.starts_at, tz.value).date === d);
const byDay = computed(() => days.value.map((d) => {
  const times = timesOn(d);
  const count = times.length ? `${times.length} ${times.length === 1 ? "time" : "times"}` : "no times";
  return {
    day: d,
    times,
    isToday: d === today,
    weekday: formatCalendarDay(d).slice(0, 3),
    date: Number(d.slice(8)),
    name: `${formatCalendarDayLong(d)}${d === today ? " (today)" : ""}, ${count}`,
  };
}));
const chosenDay = computed(() => byDay.value.find((d) => d.day === day.value));
const weekTotal = computed(() => slots.value.length);
const timesLabel = computed(() => `Times on ${formatCalendarDayLong(day.value)}, ${zone.value}`);
// Said politely when the day (or its times) change.
const announcement = computed(() => status.value === "success" && chosenDay.value
  ? `${chosenDay.value.times.length || "No"} ${chosenDay.value.times.length === 1 ? "time" : "times"} on ${formatCalendarDayLong(day.value)}`
  : "");

const chooseDay = (d: (typeof byDay.value)[number]) => {
  if (d.times.length) day.value = d.day;
};
const goToWeek = (start: string) => {
  weekStart.value = start;
  startsAt.value = "";
};
// A day from the calendar: its week, and that day if it has times.
const pickedDate = ref("");
watch(pickedDate, (d) => {
  if (!d) return;
  day.value = d;
  goToWeek(weekStartOf(d));
});

// No times this week: the next free one after it, anywhere in the window.
const next = ref<{ status: "idle" | "pending" | "done"; at: string | null }>({ status: "idle", at: null });
watch([status, weekTotal], async () => {
  next.value = { status: "idle", at: null };
  if (status.value !== "success" || weekTotal.value) return;
  next.value.status = "pending";
  const { data } = await supabase.rpc("service_next_slot", { p_listing_id: props.listing.id, p_from: addDays(weekStart.value, 7) });
  next.value = { status: "done", at: (data as string | null) ?? null };
});
const goToNext = () => {
  if (!next.value.at) return;
  const d = instantToZoned(next.value.at, tz.value).date;
  day.value = d;
  goToWeek(weekStartOf(d));
};

// ---- The time chosen ---------------------------------------------------------
const startsAt = ref("");
watch(day, () => {
  startsAt.value = "";
});
const chosen = computed(() => slots.value.find((s) => s.starts_at === startsAt.value));
const summary = computed(() => chosen.value
  ? `${formatSessionDate(chosen.value.starts_at, tz.value)}, ${formatSessionTime(chosen.value.starts_at, tz.value)} – ${formatSessionTime(chosen.value.ends_at, tz.value)} (${marketTime.value}) · ${price.value}`
  : "");
// The provider answers within 48 hours, and at least 2 hours before the start.
const answerBy = computed(() => {
  if (!chosen.value) return "";
  const by = Math.min(Date.now() + 48 * 3600_000, Date.parse(chosen.value.starts_at) - 2 * 3600_000);
  return `${formatDateTime(new Date(by), tz.value)} (${marketTime.value})`;
});
const taken = ref("");
const timesHeading = ref<HTMLElement>();
const detailsHeading = ref<HTMLElement>();
const toDetails = async () => {
  if (!chosen.value) return;
  step.value = "details";
  await nextTick();
  detailsHeading.value?.focus();
};
const toTimes = async () => {
  step.value = "time";
  await nextTick();
  timesHeading.value?.focus();
};

// ---- The customer's details --------------------------------------------------
const schema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters."),
    phone: z.string().trim().max(30, "Keep the phone number under 30 characters.").optional(),
    notes: z.string().trim().max(1000, "Keep your notes under 1,000 characters.").optional(),
    line1: z.string().trim().optional(),
    line2: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    postal_code: z.string().trim().optional(),
    instructions: z.string().trim().max(500, "Keep the access notes under 500 characters.").optional(),
  })
  .superRefine((v, ctx) => {
    if (!comesToYou.value) return;
    if (!v.line1 || v.line1.length < 3) ctx.addIssue({ code: "custom", path: ["line1"], message: "Enter the street address." });
    if (!v.city || v.city.length < 2) ctx.addIssue({ code: "custom", path: ["city"], message: "Enter the city." });
    if (!/^[A-Z]{2}$/.test(v.state ?? "")) ctx.addIssue({ code: "custom", path: ["state"], message: "Use the two-letter state, like GA." });
    if (!/^[0-9]{5}(-[0-9]{4})?$/.test(v.postal_code ?? "")) ctx.addIssue({ code: "custom", path: ["postal_code"], message: "Enter a five-digit zip code." });
  });
const { handleSubmit, values, setFieldValue } = useForm<z.input<typeof schema>>({
  validationSchema: zodSchema(schema),
  initialValues: { name: "", phone: "", notes: "", line1: "", line2: "", city: "", state: "GA", postal_code: "", instructions: "" },
  keepValuesOnUnmount: true,
});
onMounted(async () => {
  const name = await lastBookingName();
  if (name && !values.name) setFieldValue("name", name);
});

const { sending, problem, start, newAttempt } = useBookingCheckout();
// Another time or other details are a new checkout attempt (a new key).
watch([values, startsAt], newAttempt, { deep: true });
const submit = handleSubmit(async (v) => {
  taken.value = "";
  const result = await start("/api/bookings/service", {
    listingId: props.listing.id,
    startsAt: startsAt.value,
    name: v.name,
    phone: v.phone || undefined,
    notes: v.notes || undefined,
    address: comesToYou.value
      ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, postal_code: v.postal_code, instructions: v.instructions || undefined }
      : undefined,
  }, beginCheckoutEvent({
    listingId: props.listing.id, kind: "service", category: props.listing.category.slug,
    bookingMode: props.listing.bookingMode, totalCents: props.listing.priceCents,
  }));
  // Taken meanwhile: back to the times, fresh, to pick another.
  if (result === "refused" && problem.value === SLOT_TAKEN) {
    problem.value = "";
    taken.value = "That time was just taken. Pick another.";
    startsAt.value = "";
    await load();
    await toTimes();
  }
});

// Opening starts at the times, each time.
watch(open, (isOpen) => {
  if (isOpen) {
    step.value = "time";
    taken.value = "";
  }
});
onMounted(() => {
  if (asked) open.value = true;
});
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm">
      Next available: <span class="font-medium">{{ nextLabel }}</span>
    </p>
    <UiDialog v-model:open="open">
      <UiDialogTrigger as-child>
        <UiButton class="w-full">Check availability</UiButton>
      </UiDialogTrigger>
      <UiDialogContent
        class="max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-3xl"
        :aria-describedby="undefined">
        <UiDialogHeader class="text-left">
          <div class="flex items-center gap-3 pr-8">
            <NuxtImg v-if="listing.cover" :src="listing.cover.cardPath ?? listing.cover.path" alt="" width="64" height="64"
              class="size-16 shrink-0 rounded-md object-cover" />
            <div>
              <UiDialogTitle class="text-lg">Schedule your {{ listing.title }}</UiDialogTitle>
              <p class="text-muted-foreground text-sm">
                {{ price }}<template v-if="listing.durationMinutes"> · {{ formatDuration(listing.durationMinutes) }}</template>
              </p>
            </div>
          </div>
        </UiDialogHeader>

        <!-- 1. A day and a time. -->
        <div v-show="step === 'time'" class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 ref="timesHeading" tabindex="-1" class="text-sm font-medium outline-none">
              {{ weekLabel }} <span class="text-muted-foreground font-normal">· {{ zone }}</span>
            </h3>
            <div class="flex items-center gap-2">
              <UiButton variant="outline" size="touch" aria-label="Previous week" :aria-disabled="!canGoBack || undefined"
                @click="canGoBack && goToWeek(addDays(weekStart, -7))">
                <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
              </UiButton>
              <UiButton variant="outline" size="touch" aria-label="Next week" @click="goToWeek(addDays(weekStart, 7))">
                <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
              </UiButton>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span id="scheduler-go-to" class="text-sm">Go to a date</span>
            <DatePicker v-model="pickedDate" labelledby="scheduler-go-to" :min="today" touch class="w-44" />
          </div>

          <ul class="grid grid-cols-7 gap-1" aria-label="Days this week">
            <li v-for="d in byDay" :key="d.day">
              <button type="button" :aria-label="d.name" :aria-pressed="d.day === day"
                :aria-disabled="!d.times.length || status !== 'success' || undefined"
                class="focus-visible:ring-ring flex min-h-14 w-full flex-col items-center justify-center rounded-md border text-sm outline-none focus-visible:ring-2"
                :class="[
                  d.day === day && d.times.length ? 'bg-primary text-primary-foreground border-primary' : 'border-border',
                  !d.times.length ? 'text-muted-foreground cursor-not-allowed line-through' : 'hover:bg-muted',
                ]"
                @click="chooseDay(d)">
                <span aria-hidden="true" class="text-xs">{{ d.weekday }}</span>
                <span aria-hidden="true" class="font-medium">{{ d.date }}</span>
                <span v-if="d.isToday" aria-hidden="true" class="text-[0.65rem] leading-none no-underline">Today</span>
              </button>
            </li>
          </ul>

          <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
          <p v-if="taken" class="text-destructive text-sm" role="alert">{{ taken }}</p>

          <div v-if="status === 'pending' || status === 'idle'" class="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Loading times">
            <UiSkeleton v-for="n in 12" :key="n" class="h-11 rounded-md" />
          </div>
          <p v-else-if="status === 'error'" class="text-destructive text-sm">
            Times didn't load. <button type="button" class="link-text" @click="load()">Try again</button>
          </p>
          <div v-else-if="!weekTotal" class="space-y-2 text-sm">
            <p>No times this week.</p>
            <p v-if="next.status === 'pending'" class="text-muted-foreground">Looking for the next time…</p>
            <UiButton v-else-if="next.at" variant="outline" @click="goToNext">
              Next available: {{ formatSessionDate(next.at, tz) }}
            </UiButton>
            <p v-else-if="next.status === 'done'" class="text-muted-foreground">No later times are open yet. Check back soon.</p>
          </div>
          <UiRadioGroup v-else v-model="startsAt" grid :aria-label="timesLabel" class="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <label v-for="s in chosenDay?.times ?? []" :key="s.starts_at"
              class="border-border has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-primary/30 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm has-[[data-state=checked]]:font-semibold has-[[data-state=checked]]:ring-2">
              <UiRadioGroupItem :value="s.starts_at" />
              {{ formatSessionTime(s.starts_at, tz) }}
            </label>
          </UiRadioGroup>

          <div v-if="chosen" class="bg-muted space-y-2 rounded-lg p-3 text-sm">
            <p class="font-medium">{{ summary }}</p>
            <p v-if="!instant">
              Your card is held, not charged, until {{ listing.hostedBy }} accepts. They answer by {{ answerBy }}.
            </p>
          </div>
          <UiButton class="w-full" :aria-disabled="!chosen || undefined" @click="toDetails">
            {{ chosen ? "Continue" : "Choose a time to continue" }}
          </UiButton>
        </div>

        <!-- 2. The customer's details, then Checkout. -->
        <form v-show="step === 'details'" class="space-y-5" novalidate @submit="submit">
          <div class="bg-muted space-y-1 rounded-lg p-3 text-sm">
            <h3 ref="detailsHeading" tabindex="-1" class="font-medium outline-none">{{ summary }}</h3>
            <button type="button" class="link-text" @click="toTimes">Change the time</button>
          </div>

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
              hint="Shared once your booking is confirmed. For example, the gate code." />
          </fieldset>

          <UiVeeInput name="name" label="Your name" required autocomplete="name" />
          <UiVeeInput name="phone" type="tel" label="Phone (optional)" autocomplete="tel" hint="Shared with the provider once your booking is confirmed." />
          <UiVeeTextarea name="notes" label="Notes for the provider (optional)" :rows="3" maxlength="1000"
            hint="What you'd like, or anything they should know." />

          <p v-if="!instant" class="text-sm">
            Your card is held, not charged, until {{ listing.hostedBy }} accepts. They answer by {{ answerBy }}.
          </p>
          <p v-if="problem" class="text-destructive text-sm" role="alert">{{ problem }}</p>
          <UiButton type="submit" class="w-full" :disabled="sending">
            {{ sending ? "Opening checkout…" : instant ? "Book and pay" : "Request to book" }}
          </UiButton>
        </form>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
