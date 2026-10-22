<script setup lang="ts">
import {
  SUPPORT_CATEGORY_LABELS, SUPPORT_STATUSES, SUPPORT_STATUS_FOR_ADMIN, allRows, marketZone, supportAdminReplySchema, supportNoteSchema,
  type SupportCategory, type SupportStatus,
} from "@repo/types";

// One problem report, for the admin (docs/design/problem-reports.md): the
// details with links to the provider, listing and booking; the column, with
// the same "Move to…" as the board; the thread and lokl's reply ("Reply", or
// "Reply and wait for their answer", which also moves it to Waiting on
// provider); private notes the provider never sees; and the history. Read
// with the admin's own login (admin read rules); every change goes through
// the website's admin routes, logged in admin_actions. A provider's reply
// arrives as the admin bell's notification (ids only) and reloads this.
// Each save or action here first takes down the last message it showed (useSaveMessages).
const messages = useSaveMessages();
const route = useRoute();
const id = String(route.params.id);
const supabase = useSupabaseClient();
const website = useWebsiteAdmin();

interface Report {
  id: string; category: SupportCategory; urgent: boolean; description: string; status: SupportStatus;
  created_at: string; resolved_at: string | null; follows_report_id: string | null;
  provider: { id: string; display_name: string } | null;
  listing: { id: string; title: string } | null;
  booking: { id: string; starts_at: string | null; listing: { city: { name: string; timezone: string } | null } | null } | null;
}
interface Message { id: string; author_kind: string; body: string; created_at: string }
interface Note { id: string; body: string; created_at: string }
interface Event { id: string; from_status: string | null; to_status: string; actor: string; created_at: string }

const MAX = 5000;
async function load() {
  const [report, messages, notes, events] = await Promise.all([
    supabase.from("support_reports")
      .select("id, category, urgent, description, status, created_at, resolved_at, follows_report_id, provider:providers(id, display_name), " +
        "listing:listings(id, title), booking:bookings(id, starts_at, listing:listings(city:cities(name, timezone)))")
      .eq("id", id).maybeSingle(),
    allRows<Message>((from, to) => supabase.from("support_messages").select("id, author_kind, body, created_at")
      .eq("report_id", id).order("created_at").order("id").range(from, to), MAX),
    allRows<Note>((from, to) => supabase.from("support_notes").select("id, body, created_at")
      .eq("report_id", id).order("created_at").order("id").range(from, to), MAX),
    allRows<Event>((from, to) => supabase.from("support_report_events").select("id, from_status, to_status, actor, created_at")
      .eq("report_id", id).order("created_at").order("id").range(from, to), MAX),
  ]);
  if (report.error) throw new Error(report.error.message);
  return { report: report.data as unknown as Report | null, messages, notes, events };
}
const { data, error, refresh } = await useAsyncData(`admin-report-${id}`, load);
const report = computed(() => data.value?.report ?? null);
useSeoMeta({ title: () => (report.value ? `Report: ${SUPPORT_CATEGORY_LABELS[report.value.category]}` : "Report") });

// Live: a provider's reply reloads the page (and says so).
const announcement = ref("");
function announce(text: string) {
  announcement.value = "";
  void nextTick(() => (announcement.value = text));
}
async function reload() {
  const before = data.value?.messages.filter((m) => m.author_kind === "provider").length ?? 0;
  await refresh();
  if ((data.value?.messages.filter((m) => m.author_kind === "provider").length ?? 0) > before) announce("The provider replied.");
}
useLiveData({ refresh: reload });
onSupportReportChanged((changed) => {
  if (changed === id) void reload();
});

const bookingWhen = computed(() => {
  const b = report.value?.booking;
  if (!b?.starts_at) return "Booking";
  const city = b.listing?.city;
  return `${formatDateTime(b.starts_at, marketZone(city, "a reported booking"))}${city ? ` (${city.name} time)` : ""}`;
});

// Moving it.
const moving = ref(false);
async function move(to: SupportStatus) {
  messages.start();
  if (!report.value) return;
  moving.value = true;
  try {
    await website(`support-reports/${id}/status`, { to, from: report.value.status });
    await refresh();
    announce(`Moved to ${SUPPORT_STATUS_FOR_ADMIN[to]}.`);
    messages.success(`Moved to ${SUPPORT_STATUS_FOR_ADMIN[to]}.`);
  } catch (e) {
    await refresh();
    messages.error((e as Error).message);
  } finally {
    moving.value = false;
  }
}

// Replying.
const replyForm = useForm({ validationSchema: zodSchema(supportAdminReplySchema), initialValues: { body: "", wait: false } });
const replyError = ref("");
function reply(wait: boolean) {
  messages.start();
  return replyForm.handleSubmit(async (v) => {
    replyError.value = "";
    try {
      await website(`support-reports/${id}/messages`, { body: v.body, wait });
      replyForm.resetForm();
      await refresh();
      announce(wait ? "Sent. It's now waiting on the provider." : "Sent.");
      messages.success(wait ? "Sent, and moved to Waiting on provider." : "Sent. The provider has been emailed.");
    } catch (e) {
      replyError.value = (e as Error).message;
    }
  })();
}

// Private notes: their own form, so it never mixes with the reply.
const noteBody = ref("");
const noteError = ref("");
const savingNote = ref(false);
async function addNote() {
  messages.start();
  const parsed = supportNoteSchema.safeParse({ body: noteBody.value });
  if (!parsed.success) {
    noteError.value = parsed.error.issues[0]?.message ?? "Write the note.";
    return;
  }
  savingNote.value = true;
  noteError.value = "";
  try {
    await website(`support-reports/${id}/notes`, { body: parsed.data.body });
    noteBody.value = "";
    await refresh();
    announce("Note added.");
  } catch (e) {
    noteError.value = (e as Error).message;
  } finally {
    savingNote.value = false;
  }
}

const actorWord = (a: string) => (a === "admin" ? "lokl" : a === "provider" ? "The provider" : "Automatically");
</script>

<template>
  <div class="max-w-4xl">
    <NuxtLink to="/reports" class="link-secondary text-sm">Back to the board</NuxtLink>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>

    <UiAlert v-if="error" variant="destructive" icon="lucide:alert-circle" class="mt-4">
      <UiAlertTitle>This report didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="data && !report" class="mt-4" icon="lucide:search-x" title="We couldn't find that report" description="It may have been mistyped." />

    <template v-else-if="report">
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">{{ SUPPORT_CATEGORY_LABELS[report.category] }}</h1>
        <UiBadge v-if="report.urgent" variant="destructive"><Icon name="lucide:siren" class="size-3" aria-hidden="true" />Urgent</UiBadge>
        <StatusBadge kind="supportBoard" :status="report.status" />
        <UiDropdownMenu>
          <UiDropdownMenuTrigger as-child>
            <UiButton variant="outline" size="sm" :disabled="moving">Move to…</UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="start">
            <UiDropdownMenuItem v-for="to in SUPPORT_STATUSES.filter((s) => s !== report!.status)" :key="to" @select="move(to)">
              {{ SUPPORT_STATUS_FOR_ADMIN[to] }}
            </UiDropdownMenuItem>
          </UiDropdownMenuContent>
        </UiDropdownMenu>
      </div>

      <dl class="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-muted-foreground">Provider</dt>
        <dd>
          <NuxtLink v-if="report.provider" :to="`/providers?q=${encodeURIComponent(report.provider.display_name)}`" class="link-text">{{ report.provider.display_name }}</NuxtLink>
        </dd>
        <dt class="text-muted-foreground">Sent</dt>
        <dd>{{ formatHomeDateTime(report.created_at) }}</dd>
        <template v-if="report.listing">
          <dt class="text-muted-foreground">Listing</dt>
          <dd><NuxtLink :to="`/listings/${report.listing.id}`" class="link-text">{{ report.listing.title }}</NuxtLink></dd>
        </template>
        <template v-if="report.booking">
          <dt class="text-muted-foreground">Booking</dt>
          <dd><NuxtLink :to="`/bookings/${report.booking.id}`" class="link-text">{{ bookingWhen }}</NuxtLink></dd>
        </template>
        <template v-if="report.follows_report_id">
          <dt class="text-muted-foreground">Follows on from</dt>
          <dd><NuxtLink :to="`/reports/${report.follows_report_id}`" class="link-text">An earlier report</NuxtLink></dd>
        </template>
      </dl>

      <div class="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="thread-heading">
          <h2 id="thread-heading" class="text-lg font-semibold">Messages</h2>
          <ol class="mt-3 space-y-3" aria-label="Messages, oldest first">
            <li class="bg-card border-border rounded-lg border p-4">
              <p class="text-sm font-medium">Provider <span class="text-muted-foreground font-normal">· {{ formatHomeDateTime(report.created_at) }}</span></p>
              <p class="mt-1 whitespace-pre-line">{{ report.description }}</p>
            </li>
            <li v-for="m in data!.messages" :key="m.id" class="rounded-lg border p-4"
              :class="m.author_kind === 'admin' ? 'border-primary/40 bg-primary/5' : 'bg-card border-border'">
              <p class="text-sm font-medium">{{ m.author_kind === "admin" ? "lokl" : "Provider" }} <span class="text-muted-foreground font-normal">· {{ formatHomeDateTime(m.created_at) }}</span></p>
              <p class="mt-1 whitespace-pre-line">{{ m.body }}</p>
            </li>
          </ol>

          <form class="mt-6 space-y-3" novalidate @submit.prevent="reply(false)">
            <UiVeeTextarea name="body" label="Reply to the provider" :rows="4" maxlength="5000"
              hint="They're emailed that lokl replied, with a link; the email never includes your words." />
            <p v-if="replyError" role="alert" class="text-destructive text-sm">{{ replyError }}</p>
            <div class="flex flex-wrap gap-3">
              <UiButton type="submit" :disabled="replyForm.isSubmitting.value">Reply</UiButton>
              <UiButton type="button" variant="outline" :disabled="replyForm.isSubmitting.value" @click="reply(true)">Reply and wait for their answer</UiButton>
            </div>
          </form>
        </section>

        <aside class="space-y-8">
          <section aria-labelledby="notes-heading" class="bg-card border-border rounded-lg border p-4">
            <h2 id="notes-heading" class="text-base font-semibold">Private notes</h2>
            <p class="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm"><Icon name="lucide:eye-off" class="size-4" aria-hidden="true" />Only lokl sees these.</p>
            <ul v-if="data!.notes.length" class="mt-3 space-y-3">
              <li v-for="n in data!.notes" :key="n.id" class="text-sm">
                <p class="whitespace-pre-line">{{ n.body }}</p>
                <p class="text-muted-foreground mt-0.5 text-xs">{{ formatHomeDateTime(n.created_at) }}</p>
              </li>
            </ul>
            <form class="mt-4 space-y-2" novalidate @submit.prevent="addNote">
              <UiLabel for="note-body">Add a note</UiLabel>
              <UiTextarea id="note-body" v-model="noteBody" :rows="3" :maxlength="5000" :aria-invalid="!!noteError || undefined"
                :aria-describedby="noteError ? 'note-error' : undefined" />
              <p v-if="noteError" id="note-error" class="text-destructive text-sm">{{ noteError }}</p>
              <UiButton type="submit" variant="outline" size="sm" :disabled="savingNote">{{ savingNote ? "Saving…" : "Add note" }}</UiButton>
            </form>
          </section>

          <section aria-labelledby="history-heading">
            <h2 id="history-heading" class="text-base font-semibold">History</h2>
            <ol class="mt-2 space-y-1.5 text-sm">
              <li v-for="e in data!.events" :key="e.id">
                <span class="font-medium">{{ e.from_status ? `${actorWord(e.actor)} moved it to ${SUPPORT_STATUS_FOR_ADMIN[e.to_status as SupportStatus]}` : "Sent" }}</span>
                <span class="text-muted-foreground"> · {{ formatHomeDateTime(e.created_at) }}</span>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
