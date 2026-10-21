<script setup lang="ts">
import { WEEKDAYS, formatClock, weeklyHoursRows, weeklyHoursSchema, type HoursInterval, type WeeklyHoursInput } from "@repo/types";

// Weekly hours (docs/design/service-availability.md, the Availability page):
// each day an "Open" checkbox and its intervals (TimeInput, market time), with
// Add hours, Remove and Copy to every day. Saved in one step
// (replace_weekly_hours): all of it, or none if two hours overlap.
const props = defineProps<{ rows: { weekday: number; starts: string; ends: string }[] }>();
const emit = defineEmits<{ saved: [] }>();
const supabase = useSupabaseClient();

// "HH:MM:SS" from the database as "HH:MM"; an end of 24:00 is shown as 12:00 AM (midnight).
// A closed day keeps the hours the provider entered (`kept`, from the form):
// not checked and not saved while it's unticked, back when it's ticked again.
const hhmm = (t: string) => t.slice(0, 5);
const fromRows = (kept?: WeeklyHoursInput): WeeklyHoursInput => ({
  days: WEEKDAYS.map((_, weekday) => {
    const intervals = props.rows.filter((r) => r.weekday === weekday)
      .map((r) => ({ starts: hhmm(r.starts), ends: hhmm(r.ends) === "24:00" ? "00:00" : hhmm(r.ends) }))
      .sort((a, b) => a.starts.localeCompare(b.starts));
    if (intervals.length) return { open: true, intervals };
    return { open: false, intervals: (kept?.days?.[weekday]?.intervals ?? []).map((iv) => ({ ...iv })) };
  }),
});

const { handleSubmit, isSubmitting, values, setFieldValue, resetForm, errors, meta } = useForm<WeeklyHoursInput>({
  validationSchema: zodSchema(weeklyHoursSchema),
  initialValues: fromRows(),
  // A closed day's time fields are hidden, not forgotten: their values stay.
  keepValuesOnUnmount: true,
});
// Fresh rows from the page (after any save) never overwrite changes not yet
// saved (docs/frontend.md): a copy made while the page reloaded stays; and a
// closed day keeps its unsaved hours.
watch(() => props.rows, () => {
  if (!meta.value.dirty) resetForm({ values: fromRows(values as WeeklyHoursInput) });
});
// Only errors the provider can see: on an open day, or a day's own checkbox.
// The summary below never appears for a field that isn't on screen.
const visibleErrors = computed(() => Object.keys(errors.value).filter((key) => {
  const m = key.match(/^days[[.](\d+)[\].]+(open|intervals)/);
  if (!m) return true;
  return m[2] === "open" || !!values.days?.[Number(m[1])]?.open;
}));
// One field array per day (fixed: seven).
const days = WEEKDAYS.map((_, d) => useFieldArray<HoursInterval>(`days[${d}].intervals`));

// Ticking a day with no hours starts it at 9:00 AM to 5:00 PM; ticking a day
// that had hours brings them back as they were.
watch(() => values.days?.map((d) => d.open), (now, before) => {
  now?.forEach((open, d) => {
    if (open && !before?.[d] && !values.days![d]!.intervals.length) days[d]!.push({ starts: "09:00", ends: "17:00" });
  });
});
function copyToEveryDay(d: number) {
  const day = values.days![d]!;
  // Each day's own fields (its "Open" checkbox reads its own path); the
  // paths are built at run time, so the typed path checks can't follow them.
  const set = setFieldValue as (path: string, value: unknown) => void;
  WEEKDAYS.forEach((_, other) => {
    if (other === d) return;
    set(`days[${other}].intervals`, day.intervals.map((iv) => ({ ...iv })));
    set(`days[${other}].open`, day.open);
  });
  useSonner(`${WEEKDAYS[d]}'s hours copied to every day. Save to keep them.`);
}
const intervalLabel = (iv: HoursInterval) =>
  /^\d{2}:\d{2}$/.test(iv.starts) && /^\d{2}:\d{2}$/.test(iv.ends) ? `${formatClock(iv.starts)} – ${formatClock(iv.ends, { end: true })}` : "these hours";

const messages = useSaveMessages();
const submit = handleSubmit(async (v) => {
  try {
    const { error } = await supabase.rpc("replace_weekly_hours", { p_hours: weeklyHoursRows(v) });
    if (error) throw error;
    resetForm({ values: v });
    messages.success("Weekly hours saved.");
    emit("saved");
  } catch (e) {
    messages.error(problemText(e, `Your hours didn't save: ${(e as Error).message}`));
  }
});
// Every press of Save takes down the last message first, even one refused by the form's own checks.
const save = () => {
  messages.start();
  return submit();
};
</script>

<template>
  <form novalidate class="space-y-4" aria-label="Weekly hours" @submit.prevent="save">
    <fieldset v-for="(day, d) in WEEKDAYS" :key="day" class="border-border rounded-lg border p-4">
      <legend class="sr-only">{{ day }}</legend>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <UiVeeCheckbox :name="`days[${d}].open`" :label="`Open on ${day}`" />
        <button v-if="values.days?.[d]?.open" type="button" class="link-tertiary text-sm" :aria-label="`Copy ${day}'s hours to every day`" @click="copyToEveryDay(d)">
          <Icon name="lucide:copy" class="size-4" aria-hidden="true" />Copy to every day
        </button>
      </div>
      <div v-if="values.days?.[d]?.open" class="mt-3 space-y-3">
        <div v-for="(field, i) in days[d]!.fields.value" :key="field.key" class="flex flex-wrap items-end gap-3">
          <TimeInput :name="`days[${d}].intervals[${i}].starts`" :label="`From (${day})`" :minute-step="15" required />
          <TimeInput :name="`days[${d}].intervals[${i}].ends`" :label="`To (${day})`" :minute-step="15" required />
          <button type="button" class="link-tertiary mb-0.5"
            :aria-label="`Remove ${intervalLabel(field.value)} on ${day}`" @click="days[d]!.remove(i)">
            <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />Remove
          </button>
        </div>
        <button type="button" class="link-secondary" @click="days[d]!.push({ starts: '', ends: '' })">
          <Icon name="lucide:plus" class="size-4" aria-hidden="true" />Add hours on {{ day }}
        </button>
      </div>
    </fieldset>
    <p class="text-muted-foreground text-sm">An end time of 12:00 AM means midnight, the end of the day.</p>
    <p v-if="visibleErrors.length" class="text-destructive text-sm" role="alert">Check the hours marked above.</p>
    <UiButton type="submit" :disabled="isSubmitting" size="touch">{{ isSubmitting ? "Saving…" : "Save weekly hours" }}</UiButton>
  </form>
</template>
