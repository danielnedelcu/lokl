<script setup lang="ts">
import { marketZone, payoutSetupOf } from "@repo/types";

// The provider's Availability page (docs/design/service-availability.md,
// phase 2): weekly hours, hours for specific dates, time off, booking
// settings, and a preview of the times customers will see. All in the
// provider's market time ("Atlanta time"), never the device's. Each section
// saves on its own; everything is read and written under the provider's own
// row rules.
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "Availability" });

const supabase = useSupabaseClient();
const { data: provider } = await useProvider();
const providerId = computed(() => provider.value?.id ?? "");

const { data, error, refresh } = await useAsyncData("availability", async () => {
  if (!provider.value) return null;
  const city = await supabase.from("cities").select("name, timezone").eq("id", provider.value.city_id!).single();
  if (city.error) throw city.error;
  const zone = marketZone(city.data, "the provider's market");
  const today = todayIn(zone);
  const pid = provider.value.id;
  const [schedule, weekly, dated, off, services] = await Promise.all([
    supabase.from("provider_schedules").select("booking_window_days, min_notice_minutes, slot_interval_minutes, default_buffer_minutes").eq("provider_id", pid).maybeSingle(),
    // bounded: a provider's weekly intervals (a few per weekday)
    supabase.from("provider_weekly_hours").select("weekday, starts, ends").eq("provider_id", pid).limit(200),
    // bounded: a provider's upcoming dates with their own hours
    supabase.from("provider_date_hours").select("on_date, starts, ends").eq("provider_id", pid).gte("on_date", today).order("on_date").limit(500),
    // bounded: a provider's upcoming time off
    supabase.from("provider_time_off").select("id, starts_on, ends_on, note").eq("provider_id", pid).gte("ends_on", today).order("starts_on").limit(500),
    // bounded: one provider's Services
    supabase.from("listings").select("id, title, status, booking_mode").eq("provider_id", pid).eq("kind", "service").order("created_at").limit(200),
  ]);
  for (const r of [schedule, weekly, dated, off, services]) if (r.error) throw r.error;
  return {
    zone, today, zoneLabel: timeZoneLabel(city.data.name, zone),
    schedule: schedule.data, weekly: weekly.data ?? [], dated: dated.data ?? [], off: off.data ?? [], services: services.data ?? [],
  };
});
const canBePaid = computed(() => !!provider.value && payoutSetupOf(provider.value) === "ready");
const preview = useTemplateRef<{ refresh: () => Promise<void> }>("preview");
async function saved() {
  await refresh();
  await preview.value?.refresh();
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">Availability</h1>
      <p class="text-muted-foreground mt-1">When customers can book your Services.<template v-if="data"> All times are {{ data.zoneLabel }}.</template></p>
    </header>

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Your availability didn't load</UiAlertTitle>
      <UiAlertDescription>Please try again in a moment.</UiAlertDescription>
    </UiAlert>

    <template v-else-if="data">
      <section aria-labelledby="weekly-heading">
        <h2 id="weekly-heading" class="mb-1 text-lg font-semibold">Weekly hours</h2>
        <p class="text-muted-foreground mb-4 text-sm">The hours you work each week. A day can have more than one set of hours.</p>
        <AvailabilityWeekly :rows="data.weekly" @saved="saved" />
      </section>

      <section aria-labelledby="dates-heading">
        <h2 id="dates-heading" class="mb-1 text-lg font-semibold">Hours for specific dates</h2>
        <p class="text-muted-foreground mb-4 text-sm">Different hours on one date, instead of that weekday's. To take a day off, add it as time off.</p>
        <AvailabilityDates :rows="data.dated" :today="data.today" @saved="saved" />
      </section>

      <section aria-labelledby="off-heading">
        <h2 id="off-heading" class="mb-1 text-lg font-semibold">Time off</h2>
        <p class="text-muted-foreground mb-4 text-sm">Days you're not available, whatever your hours. Bookings you already have stay booked.</p>
        <AvailabilityTimeOff :rows="data.off" :provider-id="providerId" :today="data.today" @saved="saved" />
      </section>

      <section aria-labelledby="settings-heading">
        <h2 id="settings-heading" class="mb-1 text-lg font-semibold">Booking settings</h2>
        <p class="text-muted-foreground mb-4 text-sm">For all your Services.</p>
        <AvailabilitySettings :schedule="data.schedule" :provider-id="providerId" @saved="saved" />
      </section>

      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" class="mb-1 text-lg font-semibold">What customers will see</h2>
        <p class="text-muted-foreground mb-4 text-sm">The times a Service offers, from your hours and the bookings you already have.</p>
        <SlotPreview ref="preview" :services="data.services" :time-zone="data.zone" :zone-label="data.zoneLabel" :today="data.today"
          :has-hours="data.weekly.length > 0 || data.dated.length > 0" :can-be-paid="canBePaid" on-availability-page />
      </section>
    </template>
  </div>
</template>
