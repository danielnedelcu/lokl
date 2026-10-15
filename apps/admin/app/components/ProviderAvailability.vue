<script setup lang="ts">
import { WEEKDAYS, formatClock, marketZone } from "@repo/types";

// A provider's availability, read only (docs/design/service-availability.md,
// "The admin view"): their weekly hours, time off still to come, and the
// next time customers can book any of their Services. Admins read it all
// (the *_read_admin rules); nobody edits it from here: support asks the
// provider.
const props = defineProps<{ providerId: string }>();
const supabase = useSupabaseClient();

// Not awaited: it loads inside an already-open sheet.
const { data, error, status } = useAsyncData(`provider-availability-${props.providerId}`, async () => {
  const { data: provider, error: e1 } = await supabase.from("providers").select("city:cities(name, timezone)").eq("id", props.providerId).single();
  if (e1) throw e1;
  const zone = marketZone((provider as { city: { timezone: string } | null }).city, `provider ${props.providerId}`);
  const today = todayIn(zone);
  const [hours, off, services] = await Promise.all([
    // bounded: one provider's week (a few sets of hours a day)
    supabase.from("provider_weekly_hours").select("weekday, starts, ends").eq("provider_id", props.providerId).order("weekday").order("starts"),
    // bounded: one provider's time off still to come
    supabase.from("provider_time_off").select("starts_on, ends_on").eq("provider_id", props.providerId).gte("ends_on", today).order("starts_on"),
    // bounded: one provider's live Services
    supabase.from("listings").select("id").eq("provider_id", props.providerId).eq("kind", "service").eq("status", "live"),
  ]);
  for (const r of [hours, off, services]) if (r.error) throw r.error;
  const next = await Promise.all((services.data ?? []).map(async (s) => {
    const { data: at, error: e } = await supabase.rpc("service_next_slot", { p_listing_id: s.id });
    if (e) throw e;
    return at as string | null;
  }));
  const soonest = next.filter((t): t is string => !!t).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    zone,
    cityName: (provider as { city: { name: string } | null }).city?.name ?? "Atlanta",
    week: WEEKDAYS.map((name, day) => {
      const sets = (hours.data ?? []).filter((h) => h.weekday === day);
      return { name, text: sets.length ? sets.map((h) => `${formatClock(h.starts.slice(0, 5))} – ${formatClock(h.ends.slice(0, 5), { end: true })}`).join(", ") : "Closed" };
    }),
    off: (off.data ?? []).map((o) => formatDateRange(o.starts_on, o.ends_on)),
    liveServices: services.data?.length ?? 0,
    next: soonest,
  };
});
</script>

<template>
  <section class="border-border space-y-3 border-t pt-4" aria-labelledby="availability-heading">
    <h3 id="availability-heading" class="font-medium">Availability</h3>
    <p v-if="error" class="text-destructive text-sm">Their availability didn't load. Close and open this again.</p>
    <p v-else-if="status === 'pending' || status === 'idle'" class="text-muted-foreground text-sm">Loading…</p>
    <template v-else-if="data">
      <p class="text-sm">
        <span class="text-muted-foreground">Next time customers can book:</span>
        {{ data.next ? `${formatSessionDate(data.next, data.zone)}, ${formatSessionTime(data.next, data.zone)} (${data.cityName} time)`
          : data.liveServices ? "None (no hours, or every time taken)" : "None (no live Services)" }}
      </p>
      <div>
        <p class="text-muted-foreground text-sm">Weekly hours ({{ data.cityName }} time)</p>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          <template v-for="d in data.week" :key="d.name">
            <dt>{{ d.name }}</dt>
            <dd>{{ d.text }}</dd>
          </template>
        </dl>
      </div>
      <div>
        <p class="text-muted-foreground text-sm">Time off still to come</p>
        <p v-if="!data.off.length" class="text-sm">None.</p>
        <ul v-else class="mt-1 text-sm">
          <li v-for="o in data.off" :key="o">{{ o }}</li>
        </ul>
      </div>
      <p class="text-muted-foreground text-xs">Read only. To change it, the provider edits their Availability page.</p>
    </template>
  </section>
</template>
