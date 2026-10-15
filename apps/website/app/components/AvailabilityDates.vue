<script setup lang="ts">
import { dateHoursSchema, endOfInterval, formatClock, type DateHoursInput, type HoursInterval } from "@repo/types";

// Hours for specific dates (docs/design/service-availability.md): a date and
// its own intervals, replacing that weekday's hours for that date only, saved
// in one step (replace_date_hours). Upcoming dates are listed, each removable
// (back to the weekly hours). A day off is time off, below.
const props = defineProps<{ rows: { on_date: string; starts: string; ends: string }[]; today: string }>();
const emit = defineEmits<{ saved: [] }>();
const supabase = useSupabaseClient();

const hhmm = (t: string) => t.slice(0, 5);
const dates = computed(() => {
  const byDate = new Map<string, string[]>();
  for (const r of [...props.rows].sort((a, b) => (a.on_date + a.starts).localeCompare(b.on_date + b.starts))) {
    byDate.set(r.on_date, [...(byDate.get(r.on_date) ?? []), `${formatClock(hhmm(r.starts))} – ${formatClock(hhmm(r.ends))}`]);
  }
  return [...byDate].map(([date, hours]) => ({ date, label: formatCalendarDay(date), hours: hours.join(", ") }));
});

const { handleSubmit, isSubmitting, resetForm } = useForm<DateHoursInput>({
  validationSchema: zodSchema(dateHoursSchema),
  initialValues: { date: "", intervals: [{ starts: "09:00", ends: "17:00" }] },
});
const { fields, push, remove } = useFieldArray<HoursInterval>("intervals");

const save = handleSubmit(async (v) => {
  try {
    const { error } = await supabase.rpc("replace_date_hours", {
      p_date: v.date, p_hours: v.intervals.map((iv) => ({ starts: iv.starts, ends: endOfInterval(iv.ends) })),
    });
    if (error) throw error;
    useSonner.success(`Hours for ${formatCalendarDay(v.date)} saved.`);
    resetForm();
    emit("saved");
  } catch (e) {
    useSonner.error(problemText(e, `Those hours didn't save: ${(e as Error).message}`));
  }
});
async function clear(date: string) {
  const { error } = await supabase.rpc("replace_date_hours", { p_date: date, p_hours: [] });
  if (error) return useSonner.error(problemText(error, "That didn't change. Try again."));
  useSonner.success(`${formatCalendarDay(date)} is back to your weekly hours.`);
  emit("saved");
}
</script>

<template>
  <div class="space-y-6">
    <ul v-if="dates.length" class="divide-border divide-y rounded-lg border" aria-label="Dates with their own hours">
      <li v-for="d in dates" :key="d.date" class="flex flex-wrap items-center justify-between gap-2 p-3">
        <span><span class="font-medium">{{ d.label }}</span> <span class="text-muted-foreground">{{ d.hours }}</span></span>
        <button type="button" class="link-tertiary" :aria-label="`Remove the hours for ${d.label}`" @click="clear(d.date)">
          <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />Remove
        </button>
      </li>
    </ul>
    <p v-else class="text-muted-foreground text-sm">No dates with their own hours. Every day follows your weekly hours.</p>

    <form novalidate class="space-y-4" aria-label="Hours for a date" @submit.prevent="save">
      <DateInput name="date" label="Date" :min="today" required touch />
      <div v-for="(field, i) in fields" :key="field.key" class="flex flex-wrap items-end gap-3">
        <TimeInput :name="`intervals[${i}].starts`" label="From" :minute-step="15" required />
        <TimeInput :name="`intervals[${i}].ends`" label="To" :minute-step="15" required />
        <button v-if="fields.length > 1" type="button" class="link-tertiary mb-0.5" aria-label="Remove these hours" @click="remove(i)">
          <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />Remove
        </button>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="link-secondary" @click="push({ starts: '', ends: '' })">
          <Icon name="lucide:plus" class="size-4" aria-hidden="true" />Add hours
        </button>
        <UiButton type="submit" :disabled="isSubmitting" size="touch">{{ isSubmitting ? "Saving…" : "Save hours for this date" }}</UiButton>
      </div>
    </form>
  </div>
</template>
