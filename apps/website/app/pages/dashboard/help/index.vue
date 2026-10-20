<script setup lang="ts">
import { SUPPORT_CATEGORY_LABELS, rpcJson, type MySupportReportRow } from "@repo/types";

// "Your reports" (docs/design/problem-reports.md, The provider's side): the
// provider's problem reports, newest activity first, 20 at a time, paged by
// the database (my_support_reports, read through its schema).
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "Help" });

const PAGE_SIZE = 20;
const supabase = useSupabaseClient();
async function load(page: number) {
  const { data, error } = await supabase.rpc("my_support_reports", { p_page: page, p_page_size: PAGE_SIZE }, { get: true });
  if (error) throw new Error(error.message);
  return rpcJson("my_support_reports", data);
}
const { data, error, refresh } = await useAsyncData("my-support-reports", () => load(1));
// A reply from lokl arrives as a notification, which reloads this.
useLiveData({ refresh });
onSupportReportChanged(() => void refresh());

// "Show more reports": later pages, added below the first.
const more = ref<MySupportReportRow[]>([]);
const page = ref(1);
const loadingMore = ref(false);
const moreError = ref("");
watch(data, () => {
  more.value = [];
  page.value = 1;
  moreError.value = "";
});
const rows = computed(() => [...(data.value?.rows ?? []), ...more.value]);
async function showMore() {
  loadingMore.value = true;
  moreError.value = "";
  const firstNew = rows.value.length;
  try {
    const next = await load(page.value + 1);
    more.value = [...more.value, ...next.rows];
    page.value += 1;
    await nextTick();
    document.querySelectorAll<HTMLElement>("[data-report]")[firstNew]?.focus();
  } catch {
    moreError.value = "More reports didn't load. Try again.";
  } finally {
    loadingMore.value = false;
  }
}

/** What it relates to: "Morning haircut · booking on Sat, Oct 18". */
function about(r: MySupportReportRow) {
  return [r.listing?.title, r.booking ? "a booking" : null].filter(Boolean).join(" · ");
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Help</h1>
        <p class="mt-1 text-sm text-muted-foreground">Tell lokl about a problem, and follow it here until it's sorted.</p>
        <p class="mt-1 text-sm">How-to guides for hosts are in the <NuxtLink to="/help/hosts" class="link-text">Help centre</NuxtLink>.</p>
      </div>
      <UiButton to="/dashboard/help/new"><Icon name="lucide:message-square-warning" class="size-4" aria-hidden="true" />Report a problem</UiButton>
    </div>

    <h2 class="mt-8 text-lg font-semibold">Your reports</h2>
    <UiAlert v-if="error" variant="destructive" class="mt-4" icon="lucide:alert-circle">
      <UiAlertTitle>Your reports didn't load</UiAlertTitle>
      <UiAlertDescription>Please refresh the page to try again.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="data && !rows.length" class="mt-4 rounded-lg border border-dashed border-input bg-card p-8 text-center text-sm text-muted-foreground">
      You haven't reported any problems. If something's wrong, tell us and we'll help.
    </p>
    <template v-else-if="data">
      <p v-if="data.waiting" class="mt-2 text-sm font-medium">
        {{ data.waiting === 1 ? "1 report is" : `${data.waiting} reports are` }} waiting for your reply.
      </p>
      <ul class="mt-4 space-y-3">
        <li v-for="r in rows" :key="r.id" data-report tabindex="-1" class="rounded-lg border border-border bg-card p-4 outline-none">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h3 class="font-medium">
              <NuxtLink :to="`/dashboard/help/${r.id}`" class="link-text">{{ SUPPORT_CATEGORY_LABELS[r.category] }}</NuxtLink>
            </h3>
            <StatusBadge kind="supportReport" :status="r.status" />
          </div>
          <p class="mt-1 line-clamp-2 text-sm">{{ r.excerpt }}</p>
          <p class="mt-2 text-sm text-muted-foreground">
            <template v-if="about(r)">{{ about(r) }} · </template>
            {{ r.last_message_from === "admin" ? "lokl replied" : "Last changed" }} {{ formatHomeDateTime(r.last_message_at > r.status_changed_at ? r.last_message_at : r.status_changed_at) }}
          </p>
        </li>
      </ul>
      <div v-if="rows.length < data.total" class="mt-4 flex flex-wrap items-center gap-3">
        <UiButton variant="outline" :disabled="loadingMore" @click="showMore">{{ loadingMore ? "Loading…" : "Show more reports" }}</UiButton>
        <p class="text-sm text-muted-foreground">Showing {{ rows.length }} of {{ data.total }}</p>
      </div>
      <p v-if="moreError" role="alert" class="mt-2 text-sm text-destructive">{{ moreError }}</p>
    </template>
  </div>
</template>
