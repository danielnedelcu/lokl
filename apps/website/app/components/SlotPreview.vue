<script setup lang="ts">
// "What customers will see" (docs/design/service-availability.md): a week of
// one of the provider's Services' slots, in market time, from
// my_service_slots_preview (their own Services, even while a draft or before
// payouts are set up). When there are none, or customers can't book yet, it
// says why in plain words, with where to fix it. On the Availability page
// (choose a Service) and in a Service's sidebar (that Service).
type Service = { id: string; title: string; status: string; booking_mode: string | null };
const props = defineProps<{
  services: Service[];
  /** In a listing's sidebar: just that Service, no picker. */
  listingId?: string;
  timeZone: string;
  zoneLabel: string;
  today: string;
  hasHours: boolean;
  canBePaid: boolean;
  /** On the Availability page, the hours link isn't needed. */
  onAvailabilityPage?: boolean;
}>();
const supabase = useSupabaseClient();

const chosen = ref(props.listingId ?? props.services[0]?.id ?? "");
const service = computed(() => props.services.find((s) => s.id === chosen.value));
const weekStart = ref(props.today);
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)));
const weekLabel = computed(() => `${formatCalendarDay(days.value[0]!)} – ${formatCalendarDay(days.value[6]!)}`);

const { data: slots, status, refresh } = await useAsyncData(
  () => `slot-preview-${chosen.value}-${weekStart.value}`,
  async () => {
    if (!chosen.value || !service.value?.booking_mode) return [];
    const { data, error } = await supabase.rpc("my_service_slots_preview", { p_listing_id: chosen.value, p_from: days.value[0]!, p_to: days.value[6]! }, { get: true });
    if (error) throw error;
    return (data ?? []) as { starts_at: string; ends_at: string }[];
  },
  { server: false, watch: [chosen, weekStart] },
);
defineExpose({ refresh });
const byDay = computed(() => days.value.map((day) => ({
  day,
  label: formatCalendarDay(day),
  times: (slots.value ?? []).filter((s) => instantToZoned(s.starts_at, props.timeZone).date === day).map((s) => formatSessionTime(s.starts_at, props.timeZone)),
})));
const total = computed(() => (slots.value ?? []).length);

// Why customers can't book it yet, or why there's nothing to show.
const notes = computed(() => {
  const out: { text: string; to?: string; link?: string }[] = [];
  if (!props.hasHours) out.push({ text: "Set your hours first: customers can only book times you're open.", to: props.onAvailabilityPage ? undefined : "/dashboard/availability", link: "Set your hours" });
  if (service.value && !service.value.booking_mode) out.push({ text: "Choose how customers book this Service.", to: `/dashboard/listings/${service.value.id}`, link: "Edit the Service" });
  if (service.value && service.value.status !== "live") out.push({ text: "This Service isn't live yet. These are the times it will offer once it is." });
  if (!props.canBePaid) out.push({ text: "Customers can't book until payouts are set up.", to: "/dashboard/payouts", link: "Set up payouts" });
  return out;
});
</script>

<template>
  <div class="space-y-4">
    <div v-if="!listingId && services.length > 1">
      <UiLabel for="preview-service" class="mb-2">Service</UiLabel>
      <SelectInput id="preview-service" v-model="chosen" name="preview-service" touch
        :options="services.map((s) => ({ value: s.id, label: s.title }))" />
    </div>
    <p v-if="!services.length" class="text-muted-foreground text-sm">You have no Services yet. Add one, and its times show here.</p>
    <template v-else>
      <ul v-if="notes.length" class="space-y-2" aria-label="Before customers can book">
        <li v-for="n in notes" :key="n.text" class="bg-muted flex flex-wrap items-start gap-2 rounded-lg p-3 text-sm">
          <Icon name="lucide:info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{{ n.text }} <NuxtLink v-if="n.to" :to="n.to" class="link-text">{{ n.link }}</NuxtLink></span>
        </li>
      </ul>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm font-medium" aria-live="polite">{{ weekLabel }} <span class="text-muted-foreground font-normal">({{ zoneLabel }})</span></p>
        <div class="flex gap-2">
          <UiButton variant="outline" size="touch" :aria-disabled="weekStart <= today || undefined" aria-label="Previous week"
            @click="weekStart > today && (weekStart = addDays(weekStart, -7))">
            <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
          </UiButton>
          <UiButton variant="outline" size="touch" aria-label="Next week" @click="weekStart = addDays(weekStart, 7)">
            <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
          </UiButton>
        </div>
      </div>
      <!-- Fetched in the browser: "idle" is the moment before it starts, not "no times". -->
      <p v-if="status === 'pending' || status === 'idle'" class="text-muted-foreground text-sm">Loading times…</p>
      <p v-else-if="status === 'error'" class="text-destructive text-sm">Times didn't load. <button type="button" class="link-text" @click="refresh()">Try again</button></p>
      <p v-else-if="!total" class="text-muted-foreground text-sm">No times this week.</p>
      <ul v-else class="space-y-3" aria-label="Times customers will see">
        <li v-for="d in byDay" :key="d.day">
          <p class="text-sm font-medium">{{ d.label }}</p>
          <p class="text-muted-foreground text-sm">{{ d.times.length ? d.times.join(", ") : "No times" }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>
