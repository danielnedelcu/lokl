<script setup lang="ts">
import { timeOffSchema, type TimeOffInput } from "@repo/types";

// Time off (docs/design/service-availability.md): whole days the provider
// isn't available, whatever their hours, with an optional note only they
// see. Listed, each removable.
const props = defineProps<{ rows: { id: string; starts_on: string; ends_on: string; note: string | null }[]; providerId: string; today: string }>();
const emit = defineEmits<{ saved: [] }>();
const supabase = useSupabaseClient();

const label = (r: { starts_on: string; ends_on: string }) =>
  r.starts_on === r.ends_on ? formatCalendarDay(r.starts_on) : `${formatCalendarDay(r.starts_on)} – ${formatCalendarDay(r.ends_on)}`;
const list = computed(() => [...props.rows].sort((a, b) => a.starts_on.localeCompare(b.starts_on)));

const { handleSubmit, isSubmitting, resetForm } = useForm<TimeOffInput>({
  validationSchema: zodSchema(timeOffSchema),
  initialValues: { range: { start: "", end: "" }, note: "" },
});
const { value: range, errorMessage: rangeError } = useField<{ start: string; end: string }>("range");

const messages = useSaveMessages();
const submit = handleSubmit(async (v) => {
  try {
    const problem = changedRows(await supabase.from("provider_time_off")
      .insert({ provider_id: props.providerId, starts_on: v.range.start, ends_on: v.range.end, note: v.note || null }).select("id"));
    if (problem) throw problem;
    messages.success(`Time off added: ${label({ starts_on: v.range.start, ends_on: v.range.end })}.`);
    resetForm();
    emit("saved");
  } catch (e) {
    messages.error(problemText(e, `That didn't save: ${(e as Error).message}`));
  }
});
const save = () => {
  messages.start();
  return submit();
};
async function remove(r: { id: string; starts_on: string; ends_on: string }) {
  messages.start();
  try {
    const problem = changedRows(await supabase.from("provider_time_off").delete().eq("id", r.id).select("id"), "deleted");
    if (problem) throw problem;
    messages.success(`Time off removed: ${label(r)}.`);
    emit("saved");
  } catch (e) {
    messages.error(problemText(e, "That didn't change. Try again."));
  }
}
</script>

<template>
  <div class="space-y-6">
    <ul v-if="list.length" class="divide-border divide-y rounded-lg border" aria-label="Time off">
      <li v-for="r in list" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 p-3">
        <span><span class="font-medium">{{ label(r) }}</span> <span v-if="r.note" class="text-muted-foreground">{{ r.note }}</span></span>
        <button type="button" class="link-tertiary" :aria-label="`Remove time off: ${label(r)}`" @click="remove(r)">
          <Icon name="lucide:trash-2" class="size-4" aria-hidden="true" />Remove
        </button>
      </li>
    </ul>
    <p v-else class="text-muted-foreground text-sm">No time off coming up.</p>

    <form novalidate class="space-y-4" aria-label="Add time off" @submit.prevent="save">
      <div>
        <p id="time-off-days" class="mb-2 text-sm font-medium">Days off</p>
        <DateRangePicker v-model="range" label="Days off" empty-text="Choose days" :min="today" touch
          :aria-describedby="rangeError ? 'time-off-days-error' : undefined" />
        <p v-if="rangeError" id="time-off-days-error" class="text-destructive mt-1 text-sm">{{ rangeError }}</p>
      </div>
      <UiVeeInput name="note" label="Note (optional, only you see it)" />
      <UiButton type="submit" :disabled="isSubmitting" size="touch">{{ isSubmitting ? "Saving…" : "Add time off" }}</UiButton>
    </form>
  </div>
</template>
