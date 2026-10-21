<script setup lang="ts">
import { SCHEDULE_CHOICES, SCHEDULE_DEFAULTS, durationWords, scheduleSchema, type ScheduleInput, type ScheduleOutput } from "@repo/types";

// Booking settings (docs/design/service-availability.md): how far ahead
// customers can book, the least notice, how often a booking can start, and
// the time between bookings (for travel). Saved together (one row per
// provider; the defaults apply until then).
const props = defineProps<{
  schedule: { booking_window_days: number; min_notice_minutes: number; slot_interval_minutes: number; default_buffer_minutes: number } | null;
  providerId: string;
}>();
const emit = defineEmits<{ saved: [] }>();
const supabase = useSupabaseClient();

const fromSchedule = (): ScheduleInput => {
  const s = props.schedule ?? SCHEDULE_DEFAULTS;
  return {
    booking_window_days: String(s.booking_window_days), min_notice_minutes: String(s.min_notice_minutes),
    slot_interval_minutes: String(s.slot_interval_minutes), default_buffer_minutes: String(s.default_buffer_minutes),
  };
};
const { handleSubmit, isSubmitting, resetForm, meta } = useForm<ScheduleInput, ScheduleOutput>({
  validationSchema: zodSchema(scheduleSchema),
  initialValues: fromSchedule(),
});
// Fresh settings never overwrite changes not yet saved (docs/frontend.md).
watch(() => props.schedule, () => {
  if (!meta.value.dirty) resetForm({ values: fromSchedule() });
});

const days = (n: number) => (n === 7 ? "1 week" : n === 14 ? "2 weeks" : `${n} days`);
const options = {
  booking_window_days: SCHEDULE_CHOICES.booking_window_days.map((n) => ({ value: String(n), label: days(n) })),
  min_notice_minutes: SCHEDULE_CHOICES.min_notice_minutes.map((n) => ({ value: String(n), label: durationWords(n) })),
  slot_interval_minutes: SCHEDULE_CHOICES.slot_interval_minutes.map((n) => ({ value: String(n), label: `Every ${durationWords(n)}` })),
  default_buffer_minutes: SCHEDULE_CHOICES.default_buffer_minutes.map((n) => ({ value: String(n), label: n === 0 ? "None" : durationWords(n) })),
};

const messages = useSaveMessages();
const submit = handleSubmit(async (v) => {
  try {
    // Insert the first time, update after: an upsert would also write
    // provider_id, which providers may not change.
    const problem = changedRows(await (props.schedule
      ? supabase.from("provider_schedules").update(v).eq("provider_id", props.providerId).select("provider_id")
      : supabase.from("provider_schedules").insert({ provider_id: props.providerId, ...v }).select("provider_id")));
    if (problem) throw problem;
    resetForm({ values: {
      booking_window_days: String(v.booking_window_days), min_notice_minutes: String(v.min_notice_minutes),
      slot_interval_minutes: String(v.slot_interval_minutes), default_buffer_minutes: String(v.default_buffer_minutes),
    } });
    messages.success("Booking settings saved.");
    emit("saved");
  } catch (e) {
    messages.error(problemText(e, `Your settings didn't save: ${(e as Error).message}`));
  }
});
const save = () => {
  messages.start();
  return submit();
};
</script>

<template>
  <form novalidate class="grid gap-5 sm:grid-cols-2" aria-label="Booking settings" @submit.prevent="save">
    <UiVeeSelect name="booking_window_days" label="How far ahead customers can book" touch :options="options.booking_window_days"
      hint="Customers see times up to this far ahead." />
    <UiVeeSelect name="min_notice_minutes" label="Least notice you need" touch :options="options.min_notice_minutes"
      hint="Customers can't book a time sooner than this. Services you approve need at least 4 hours." />
    <UiVeeSelect name="slot_interval_minutes" label="Bookings can start" touch :options="options.slot_interval_minutes"
      hint="How often a time is offered: every 30 minutes gives 9:00, 9:30, 10:00…" />
    <UiVeeSelect name="default_buffer_minutes" label="Time between bookings" touch :options="options.default_buffer_minutes"
      hint="Free time after each booking, for travel or tidying up. A Service can set its own." />
    <div class="sm:col-span-2">
      <UiButton type="submit" :disabled="isSubmitting" size="touch">{{ isSubmitting ? "Saving…" : "Save booking settings" }}</UiButton>
    </div>
  </form>
</template>
