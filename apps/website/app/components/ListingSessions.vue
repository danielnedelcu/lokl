<script setup lang="ts">
import { z } from "zod";
import type { ListingStatus } from "@repo/types";

// The editor's Sessions section (Experiences). Times are entered and shown in
// the listing city's time zone (zonedTime.ts), whatever the device's zone.
// The database checks the rest: future only, a year ahead at most, no two
// sessions at the same time, locked while in review or taken down.
const props = defineProps<{
  listingId: string;
  status: ListingStatus;
  cityName: string;
  timeZone: string;
  durationMinutes: number | null;
}>();
const emit = defineEmits<{ changed: [] }>();

const supabase = useSupabaseClient();

interface SessionRow {
  id: string;
  starts_at: string;
  capacity: number;
  status: "scheduled" | "cancelled";
}

const { data: sessions, refresh, error: loadError } = await useAsyncData(`listing-sessions-${props.listingId}`, async () => {
  const { data, error } = await supabase
    .from("experience_sessions")
    .select("id, starts_at, capacity, status")
    .eq("listing_id", props.listingId)
    .order("starts_at");
  if (error) throw error;
  return data as SessionRow[];
});

// Bookings per session: any booking row at all (even an expired checkout)
// means the session can't be deleted, only cancelled with refunds.
const { data: bookingsBySession, refresh: refreshBookings } = await useAsyncData(`listing-session-bookings-${props.listingId}`, async () => {
  const { data, error } = await supabase
    .from("bookings")
    .select("session_id, status, party_size, total_cents")
    .eq("listing_id", props.listingId)
    .not("session_id", "is", null);
  if (error) throw error;
  const map = new Map<string, { rows: number; booked: number; refundCents: number }>();
  for (const b of data ?? []) {
    const m = map.get(b.session_id!) ?? { rows: 0, booked: 0, refundCents: 0 };
    m.rows++;
    if (b.status === "confirmed") { m.booked += b.party_size; m.refundCents += b.total_cents; }
    map.set(b.session_id!, m);
  }
  return Object.fromEntries(map);
});
const bookingsOf = (s: SessionRow) => bookingsBySession.value?.[s.id] ?? { rows: 0, booked: 0, refundCents: 0 };

async function reload() {
  await Promise.all([refresh(), refreshBookings()]);
  emit("changed");
}

// Past sessions are kept but tucked away; they can't be changed.
const nowMs = ref(Date.now());
const upcoming = computed(() => (sessions.value ?? []).filter((s) => Date.parse(s.starts_at) > nowMs.value));
const past = computed(() => (sessions.value ?? []).filter((s) => Date.parse(s.starts_at) <= nowMs.value).reverse());
const showPast = ref(false);

const editable = computed(() => ["draft", "rejected", "live"].includes(props.status));
const zoneLabel = computed(() => timeZoneLabel(props.cityName, props.timeZone));
const busy = ref(false);

const dateOf = (s: SessionRow) => formatSessionDate(s.starts_at, props.timeZone);
const timeOf = (s: SessionRow) => {
  const start = formatSessionTime(s.starts_at, props.timeZone);
  if (!props.durationMinutes) return start;
  const end = new Date(Date.parse(s.starts_at) + props.durationMinutes * 60_000).toISOString();
  return `${start} – ${formatSessionTime(end, props.timeZone)}`;
};
const spotsOf = (s: SessionRow) => `${s.capacity} ${s.capacity === 1 ? "spot" : "spots"}`;
const describe = (s: SessionRow) => `${dateOf(s)} at ${formatSessionTime(s.starts_at, props.timeZone)}`;

// ---------------------------------------------------------------------------
// Add or edit
// ---------------------------------------------------------------------------

const MAX_WEEKS = 12;
const formOpen = ref(false);
const editing = ref<SessionRow | null>(null);

const today = computed(() => todayIn(props.timeZone));
const maxDate = computed(() => addDays(today.value, 365));

const sessionSchema = z
  .object({
    date: z.string().min(1, "Choose a date."),
    time: z.string().min(1, "Choose a start time.").refine(isTimeOfDay, "Choose the hour, minutes and AM or PM."),
    capacity: z.coerce
      .number({ message: "Enter the number of spots." })
      .int("Use a whole number.")
      .min(1, "A session needs at least 1 spot.")
      .max(500, "A session can have up to 500 spots."),
    repeat: z.boolean().optional(),
    weeks: z.coerce.number().optional(),
  })
  .superRefine((v, ctx) => {
    // A date that has passed says so on the date, whatever the time; today
    // at a time that has passed says so on the time.
    if (v.date && v.date < todayIn(props.timeZone)) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "The date has passed. The start time must be in the future." });
    } else if (v.date && isTimeOfDay(v.time) && Date.parse(zonedToInstant(v, props.timeZone)) <= Date.now()) {
      ctx.addIssue({ code: "custom", path: ["time"], message: "That time has passed. The start time must be in the future." });
    }
    if (v.repeat && (!Number.isInteger(v.weeks) || v.weeks! < 2 || v.weeks! > MAX_WEEKS)) {
      ctx.addIssue({ code: "custom", path: ["weeks"], message: `Choose 2 to ${MAX_WEEKS} weeks.` });
    }
  });
type SessionForm = z.input<typeof sessionSchema>;

const form = useForm<SessionForm>({ validationSchema: zodSchema(sessionSchema) });
const repeating = computed(() => !editing.value && !!form.values.repeat);

// A new session starts from the last one's spots, so a host running the same
// size group doesn't retype it.
function openAdd() {
  editing.value = null;
  const last = upcoming.value.at(-1) ?? past.value[0];
  form.resetForm({ values: { date: "", time: "", capacity: last?.capacity ?? 10, repeat: false, weeks: 4 } });
  formOpen.value = true;
}

function openEdit(s: SessionRow) {
  editing.value = s;
  form.resetForm({ values: { ...instantToZoned(s.starts_at, props.timeZone), capacity: s.capacity } });
  formOpen.value = true;
}

// The series preview under the form: "Sat, Oct 24 to Sat, Dec 12 (8 sessions)".
const seriesSummary = computed(() => {
  const v = form.values;
  if (!repeating.value || !v.date || !v.time) return "";
  const weeks = Number(v.weeks);
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_WEEKS) return "";
  const all = weeklyInstants({ date: v.date, time: v.time }, weeks, props.timeZone);
  return `${formatSessionDate(all[0]!, props.timeZone)} to ${formatSessionDate(all.at(-1)!, props.timeZone)}, every week at ${formatSessionTime(all[0]!, props.timeZone)} (${weeks} sessions).`;
});

// A series is one insert, so if any week clashes with an existing session
// the database saves none of it and names the clashing date.
const save = form.handleSubmit(async (v) => {
  const capacity = Number(v.capacity);
  busy.value = true;
  const error = changedRows(editing.value
    ? await supabase
        .from("experience_sessions")
        .update({ starts_at: zonedToInstant(v, props.timeZone), capacity })
        .eq("id", editing.value.id)
        .select("id")
    : await supabase.from("experience_sessions").insert(
        (v.repeat ? weeklyInstants(v, Number(v.weeks), props.timeZone) : [zonedToInstant(v, props.timeZone)])
          .map((starts_at) => ({ listing_id: props.listingId, starts_at, capacity })),
      ).select("id"));
  busy.value = false;
  if (error) {
    const saving = editing.value ? "The change wasn't saved" : v.repeat ? "None of these sessions were added" : "The session wasn't added";
    return useSonner.error(problemText(error, `${saving}. ${error.message}`));
  }
  useSonner.success(editing.value ? "Session updated." : v.repeat ? `${v.weeks} sessions added.` : "Session added.");
  formOpen.value = false;
  nowMs.value = Date.now();
  await reload();
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

// A session nobody has booked is removed. One with bookings is cancelled
// through the server, which refunds everyone in full (decision 12).
const cancelling = ref<SessionRow | null>(null);
const cancelOpen = ref(false);
const cancelBookedOpen = ref(false);
const cancelError = ref("");
function askCancel(s: SessionRow) {
  cancelling.value = s;
  cancelError.value = "";
  if (bookingsOf(s).rows > 0) cancelBookedOpen.value = true;
  else cancelOpen.value = true;
}
async function confirmCancelBooked(reason: string) {
  if (!cancelling.value) return;
  busy.value = true;
  try {
    await $fetch(`/api/sessions/${cancelling.value.id}/cancel`, { method: "POST", body: { reason } });
    cancelBookedOpen.value = false;
    useSonner.success("Session cancelled. Everyone booked is refunded in full.");
  } catch (e) {
    cancelError.value = (e as { statusMessage?: string }).statusMessage ?? "The session wasn't cancelled. Please try again.";
  } finally {
    busy.value = false;
    await reload();
  }
}
async function confirmCancel() {
  if (!cancelling.value) return;
  busy.value = true;
  const error = changedRows(await supabase.from("experience_sessions").delete().eq("id", cancelling.value.id).select("id"), "deleted");
  busy.value = false;
  cancelOpen.value = false;
  if (error) return useSonner.error(problemText(error, `The session wasn't cancelled. ${error.message}`));
  useSonner.success("Session cancelled.");
  await reload();
}
</script>

<template>
  <UiCard>
    <UiCardHeader>
      <UiCardTitle as="h2">Sessions</UiCardTitle>
      <UiCardDescription>
        The dates customers can book. Times are {{ zoneLabel }}.
      </UiCardDescription>
    </UiCardHeader>
    <UiCardContent class="space-y-4">
      <p v-if="!editable" class="text-muted-foreground text-sm">
        Sessions can't be changed while this Experience is {{ status === "submitted" ? "in review" : "taken down" }}.
      </p>

      <UiAlert v-if="loadError" variant="destructive">
        <UiAlertTitle>We couldn't load your sessions</UiAlertTitle>
        <UiAlertDescription>Refresh the page to try again.</UiAlertDescription>
      </UiAlert>

      <p v-else-if="!upcoming.length" class="border-border rounded-md border border-dashed p-6 text-center text-sm">
        No upcoming sessions. Add one so customers can book.
      </p>

      <ul v-else class="divide-border divide-y rounded-lg border">
        <li v-for="s in upcoming" :key="s.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ dateOf(s) }}</p>
            <p class="text-muted-foreground text-sm">
              {{ timeOf(s) }} · {{ spotsOf(s) }}<template v-if="bookingsOf(s).booked"> · {{ bookingsOf(s).booked }} booked</template>
            </p>
          </div>
          <StatusBadge v-if="s.status === 'cancelled'" kind="session" :status="s.status" />
          <div v-else-if="editable" class="flex gap-1">
            <UiButton variant="ghost" :disabled="busy" :aria-label="`Edit the session on ${describe(s)}`" @click="openEdit(s)">
              Edit
            </UiButton>
            <UiButton variant="ghost" class="text-destructive" :disabled="busy"
              :aria-label="`Cancel the session on ${describe(s)}`" @click="askCancel(s)">
              Cancel
            </UiButton>
          </div>
        </li>
      </ul>

      <UiButton v-if="editable" variant="outline" :disabled="busy" @click="openAdd">Add a session</UiButton>

      <div v-if="past.length">
        <UiButton variant="link" class="px-0" :aria-expanded="showPast" aria-controls="past-sessions" @click="showPast = !showPast">
          <Icon :name="showPast ? 'lucide:chevron-down' : 'lucide:chevron-right'" aria-hidden="true" />
          Past sessions ({{ past.length }})
        </UiButton>
        <ul v-show="showPast" id="past-sessions" class="text-muted-foreground mt-2 space-y-1 text-sm">
          <li v-for="s in past" :key="s.id">
            {{ dateOf(s) }}, {{ timeOf(s) }} · {{ spotsOf(s) }}
            <StatusBadge v-if="s.status === 'cancelled'" kind="session" :status="s.status" class="ml-2" />
          </li>
        </ul>
      </div>
    </UiCardContent>
  </UiCard>

  <UiDialog v-model:open="formOpen">
    <UiDialogContent :title="editing ? 'Edit session' : 'Add a session'" :description="`Times are ${zoneLabel}.`">
      <template #content>
        <form id="session-form" class="space-y-4" novalidate @submit="save">
          <div class="grid gap-4">
            <DateInput name="date" label="Date" required :min="today" :max="maxDate" touch />
            <TimeInput name="time" label="Start time" required :minute-step="5" />
          </div>
          <UiVeeNumberField name="capacity" :min="1" :max="500" label="Spots" required touch
            hint="How many people can book this session." />
          <template v-if="!editing">
            <UiVeeCheckbox name="repeat" label="Repeat every week" />
            <template v-if="repeating">
              <UiVeeNumberField name="weeks" :min="2" :max="MAX_WEEKS" touch
                label="How many weeks in total?" required :hint="`Including the first one. Up to ${MAX_WEEKS}.`" />
              <p v-if="seriesSummary" class="text-muted-foreground text-sm" aria-live="polite">{{ seriesSummary }}</p>
            </template>
          </template>
        </form>
      </template>
      <template #footer>
        <UiDialogFooter>
          <UiButton variant="outline" @click="formOpen = false">Close</UiButton>
          <UiButton type="submit" form="session-form" :disabled="busy">
            {{ busy ? "Saving…" : editing ? "Save changes" : repeating ? "Add sessions" : "Add session" }}
          </UiButton>
        </UiDialogFooter>
      </template>
    </UiDialogContent>
  </UiDialog>

  <SessionCancelDialog v-if="cancelling" v-model:open="cancelBookedOpen" :when="describe(cancelling)"
    :booked="bookingsOf(cancelling).booked" :refund-cents="bookingsOf(cancelling).refundCents" :busy="busy" :error="cancelError"
    @confirm="confirmCancelBooked" />

  <UiAlertDialog v-model:open="cancelOpen" title="Cancel this session?"
    :description="cancelling ? `The session on ${describe(cancelling)} will be removed. This can't be undone.` : ''">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep session" />
        <UiAlertDialogAction text="Cancel session" variant="destructive" :disabled="busy" @click.prevent="confirmCancel()" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
