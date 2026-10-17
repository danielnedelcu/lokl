<script setup lang="ts">
import {
  SUPPORT_CATEGORY_LABELS, SUPPORT_REOPEN_DAYS, SUPPORT_STATUS_FOR_PROVIDER, allRows, marketZone, supportCanReply, supportMessageSchema,
  supportRefusalText, type SupportCategory, type SupportStatus,
} from "@repo/types";

// One problem report (docs/design/problem-reports.md, The provider's side):
// its details, its status in words with a sentence, the thread (the
// description first, then the messages, oldest first) and the reply box.
// Read through the provider's own client, so their read rules decide.
// Replies are written by the website, which emails lokl.
//
// Live (decided 2026-10-17): no message text goes through Realtime. When
// lokl replies, the provider's bell gets a notification naming this report
// (ids only), which announces it; this page then reloads the thread itself.
definePageMeta({ layout: "dashboard", middleware: "provider-only" });

const route = useRoute();
const id = String(route.params.id);
const supabase = useSupabaseClient();
const supportEmail = useRuntimeConfig().public.supportEmail;

interface Report {
  id: string; category: SupportCategory; urgent: boolean; description: string; status: SupportStatus;
  resolved_at: string | null; created_at: string; follows_report_id: string | null;
  listing: { id: string; title: string } | null;
  booking: { id: string; starts_at: string | null; customer_name: string; listing: { city: { name: string; timezone: string } | null } | null } | null;
}
interface Message { id: string; author_kind: string; body: string; created_at: string }

const MAX_MESSAGES = 5000;
async function load() {
  const [report, messages] = await Promise.all([
    supabase.from("support_reports")
      .select("id, category, urgent, description, status, resolved_at, created_at, follows_report_id, " +
        "listing:listings(id, title), booking:bookings(id, starts_at, customer_name, listing:listings(city:cities(name, timezone)))")
      .eq("id", id).maybeSingle(),
    allRows<Message>((from, to) => supabase.from("support_messages").select("id, author_kind, body, created_at")
      .eq("report_id", id).order("created_at").order("id").range(from, to), MAX_MESSAGES),
  ]);
  if (report.error) throw new Error(report.error.message);
  return { report: report.data as unknown as Report | null, messages };
}
const { data, error, refresh } = await useAsyncData(`support-report-${id}`, load);
if (!error.value && !data.value?.report) throw createError({ statusCode: 404, data: { message: "We couldn't find that report." }, fatal: true });
const report = computed(() => data.value?.report ?? null);
const messages = computed(() => data.value?.messages ?? []);
useSeoMeta({ title: () => (report.value ? `Report: ${SUPPORT_CATEGORY_LABELS[report.value.category]}` : "Report") });

// Live: a notification about this report reloads it, and says when lokl replied.
const announcement = ref("");
async function reload() {
  const before = messages.value.filter((m) => m.author_kind === "admin").length;
  await refresh();
  if (messages.value.filter((m) => m.author_kind === "admin").length > before) announcement.value = "lokl replied.";
}
useLiveData({ refresh: reload });
onSupportReportChanged((changed) => {
  if (changed === id) void reload();
});

const status = computed(() => (report.value ? SUPPORT_STATUS_FOR_PROVIDER[report.value.status] : null));
const canReply = computed(() => !!report.value && supportCanReply(report.value));
const canSort = computed(() => !!report.value && !report.value.urgent && report.value.status !== "done");
const bookingWhen = computed(() => {
  const b = report.value?.booking;
  if (!b?.starts_at) return "";
  const city = b.listing?.city;
  return `${bookingAt(b.starts_at, marketZone(city, "a provider's booking"))}${city ? ` (${city.name} time)` : ""}`;
});

// Replying.
const { handleSubmit, isSubmitting, resetForm } = useForm({ validationSchema: zodSchema(supportMessageSchema), initialValues: { body: "" } });
const replyProblem = ref("");
const sendReply = handleSubmit(async (v) => {
  replyProblem.value = "";
  try {
    await $fetch(`/api/provider/support-reports/${id}/messages`, { method: "POST", body: v });
    resetForm();
    await refresh();
    announcement.value = "Sent.";
    useSonner.success("Sent. We'll reply here.");
  } catch (e) {
    replyProblem.value = supportRefusalText((e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.", supportEmail);
  }
});

// "This is sorted".
const sorting = ref(false);
async function markSorted() {
  sorting.value = true;
  try {
    await $fetch(`/api/provider/support-reports/${id}/sorted`, { method: "POST" });
    await refresh();
    useSonner.success("Marked as resolved. If it comes back, reply here.");
  } catch (e) {
    useSonner.error((e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.");
  } finally {
    sorting.value = false;
  }
}
</script>

<template>
  <div class="max-w-3xl">
    <NuxtLink to="/dashboard/help" class="link-secondary text-sm">Back to Help</NuxtLink>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>

    <UiAlert v-if="error" variant="destructive" class="mt-4" icon="lucide:alert-circle">
      <UiAlertTitle>This report didn't load</UiAlertTitle>
      <UiAlertDescription>Please refresh the page to try again.</UiAlertDescription>
    </UiAlert>

    <template v-else-if="report && status">
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">{{ SUPPORT_CATEGORY_LABELS[report.category] }}</h1>
        <StatusBadge kind="supportReport" :status="report.status" />
      </div>
      <p class="mt-1 text-sm">{{ status.sentence }}</p>

      <UiAlert v-if="report.urgent" variant="destructive" icon="lucide:siren" class="mt-6">
        <UiAlertTitle as="h2">If anyone is in danger, call 911 first</UiAlertTitle>
        <UiAlertDescription>We've told the team about this report. Only lokl closes a safety report.</UiAlertDescription>
      </UiAlert>

      <dl class="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-muted-foreground">Sent</dt>
        <dd>{{ formatHomeDateTime(report.created_at) }}</dd>
        <template v-if="report.listing">
          <dt class="text-muted-foreground">Listing</dt>
          <dd><NuxtLink :to="`/dashboard/listings/${report.listing.id}`" class="link-text">{{ report.listing.title }}</NuxtLink></dd>
        </template>
        <template v-if="report.booking">
          <dt class="text-muted-foreground">Booking</dt>
          <dd><NuxtLink :to="`/dashboard/bookings/${report.booking.id}`" class="link-text">{{ [bookingWhen, report.booking.customer_name].filter(Boolean).join(", ") }}</NuxtLink></dd>
        </template>
        <template v-if="report.follows_report_id">
          <dt class="text-muted-foreground">Follows on from</dt>
          <dd><NuxtLink :to="`/dashboard/help/${report.follows_report_id}`" class="link-text">Your earlier report</NuxtLink></dd>
        </template>
      </dl>

      <h2 class="mt-8 text-lg font-semibold">Messages</h2>
      <ol class="mt-3 space-y-3" aria-label="Messages, oldest first">
        <li class="rounded-lg border border-border bg-card p-4">
          <p class="text-sm font-medium">You <span class="font-normal text-muted-foreground">· {{ formatHomeDateTime(report.created_at) }}</span></p>
          <p class="mt-1 whitespace-pre-line">{{ report.description }}</p>
        </li>
        <li v-for="m in messages" :key="m.id" data-message class="rounded-lg border p-4"
          :class="m.author_kind === 'admin' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'">
          <p class="text-sm font-medium">{{ m.author_kind === "admin" ? "lokl" : "You" }} <span class="font-normal text-muted-foreground">· {{ formatHomeDateTime(m.created_at) }}</span></p>
          <p class="mt-1 whitespace-pre-line">{{ m.body }}</p>
        </li>
      </ol>

      <form v-if="canReply" class="mt-6 space-y-3" novalidate @submit="sendReply">
        <UiVeeTextarea name="body" label="Your reply" :rows="4" maxlength="5000"
          :hint="report.status === 'done' ? 'Replying reopens this report.' : undefined" />
        <p v-if="replyProblem" role="alert" class="text-sm text-destructive">{{ replyProblem }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton type="submit" :disabled="isSubmitting">{{ isSubmitting ? "Sending…" : "Send reply" }}</UiButton>
          <UiButton v-if="canSort" type="button" variant="outline" :disabled="sorting" @click="markSorted">
            <Icon name="lucide:check" class="size-4" aria-hidden="true" />{{ sorting ? "Saving…" : "This is sorted" }}
          </UiButton>
        </div>
      </form>
      <div v-else class="mt-6 rounded-lg border border-dashed border-input bg-card p-4 text-sm">
        <p>This report was resolved more than {{ SUPPORT_REOPEN_DAYS }} days ago, so it can't be reopened.</p>
        <UiButton :to="`/dashboard/help/new?follows=${report.id}`" variant="outline" class="mt-3">Start a new report about this</UiButton>
      </div>
    </template>
  </div>
</template>
