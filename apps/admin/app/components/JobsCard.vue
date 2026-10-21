<script setup lang="ts">
// The scheduled jobs (the job scheduler, 2026-10-21): each one's last
// success and whether the watchdog has found it late, failing or stuck, in
// plain words. Read from job_status (every run updates it). The watchdog
// alerts the owners itself; this is where to look.
const supabase = useSupabaseClient();
const NAMES: Record<string, { label: string; what: string }> = {
  "send-emails": { label: "Emails", what: "sends and retries the emails" },
  "release-reservations": { label: "Unpaid checkouts", what: "lets go of checkouts not paid in time" },
  "expire-requests": { label: "Unanswered requests", what: "ends requests not answered in 48 hours" },
  "withdraw-unavailable": { label: "Unavailable bookings", what: "ends bookings whose listing or provider is gone" },
  "pay-out": { label: "Payouts", what: "completes bookings and pays providers" },
  "held-photos": { label: "Hidden photos' files", what: "finishes moving hidden photos" },
  "refresh-open-days": { label: "Open days", what: "keeps Services' searchable days current" },
  "admin-requests": { label: "Expired requests", what: "expires support's requests after 7 days" },
  "review-reminders": { label: "Review reminders", what: "reminds customers to review" },
  "hidden-content-reminder": { label: "Hidden content reminder", what: "reminds you of hidden content waiting 7 days" },
};
const every = (s: number) => (s >= 86400 ? "daily" : s >= 3600 ? "hourly" : s >= 120 ? `every ${s / 60} minutes` : "every minute");

const { data: jobs, error } = await useAsyncData("admin-jobs", async () => {
  // bounded: one row per scheduled job, ten of them
  const { data, error: e } = await supabase.from("job_status")
    .select("job, interval_seconds, last_success_at, last_outcome, consecutive_failures, alert_kind").order("job");
  if (e) throw e;
  return data ?? [];
});
watch(error, (e) => e && reportProblem("Couldn't load the jobs", e), { immediate: true });
const state = (j: NonNullable<typeof jobs.value>[number]) =>
  j.alert_kind === "stuck" ? { words: "Stuck: a run never finished", bad: true }
  : j.alert_kind === "failing" || j.consecutive_failures >= 3 ? { words: `Failing (${j.consecutive_failures} in a row)`, bad: true }
  : j.alert_kind === "late" ? { words: "Late", bad: true }
  : !j.last_success_at ? { words: "Not run yet", bad: false }
  : { words: "Running normally", bad: false };
</script>

<template>
  <section aria-labelledby="jobs-heading" class="mt-10">
    <h2 id="jobs-heading" class="mb-1 text-sm font-semibold">Jobs</h2>
    <p class="text-muted-foreground mb-3 text-sm">
      The work lokl does on a timetable. You're told by email if one is late, failing or stuck, and again when it recovers.
      Until hosting is set up, none run on their own.
    </p>
    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load the jobs</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <ul v-else class="divide-border bg-card border-border divide-y rounded-lg border text-sm">
      <li v-for="j in jobs ?? []" :key="j.job" class="flex flex-wrap items-baseline justify-between gap-2 p-3">
        <span>
          <span class="font-medium">{{ NAMES[j.job]?.label ?? j.job }}</span>
          <span class="text-muted-foreground"> · {{ NAMES[j.job]?.what }}, {{ every(j.interval_seconds) }}</span>
        </span>
        <span :class="state(j).bad ? 'text-destructive' : 'text-muted-foreground'">
          <Icon :name="state(j).bad ? 'lucide:triangle-alert' : 'lucide:circle-check'" class="mr-1 inline size-4" aria-hidden="true" />{{ state(j).words }}<template
            v-if="j.last_success_at"> · last success {{ formatHomeDateTime(j.last_success_at) }} (Atlanta time)</template>
        </span>
      </li>
    </ul>
  </section>
</template>
