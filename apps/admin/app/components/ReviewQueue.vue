<script setup lang="ts">
// Experiences waiting for review, oldest first (design: Review queue), 50
// at a time; the count is every one waiting (utils/reviewQueue.ts).
const emit = defineEmits<{ count: [n: number] }>();

const supabase = useSupabaseClient();
const { data, error, pending, refresh } = await useAsyncData("admin-review-queue", () => reviewQueuePage(supabase));
const more = ref<ReviewQueueRow[]>([]);
watch(data, () => (more.value = []));
const rows = computed(() => [...(data.value?.items ?? []), ...more.value]);
const total = computed(() => data.value?.total ?? 0);
watchEffect(() => emit("count", total.value));
const loadingMore = ref(false);
async function showMore() {
  loadingMore.value = true;
  const firstNew = rows.value.length;
  try {
    const next = await reviewQueuePage(supabase, Math.floor(firstNew / REVIEW_QUEUE_PAGE_SIZE) + 1);
    more.value = [...more.value, ...next.items];
    // Focus the first new one, so keyboard users carry on from there.
    await nextTick();
    document.querySelectorAll<HTMLElement>("[data-queue-item]")[firstNew]?.focus();
  } catch (e) {
    reportProblem("Couldn't load more of the review queue", e);
  } finally {
    loadingMore.value = false;
  }
}
// New submissions arrive meanwhile: refresh when the tab is back in view.
useLiveData({ refresh });
watch(error, (e) => e && reportProblem("Couldn't load the review queue", e), { immediate: true });
</script>

<template>
  <UiAlert v-if="error" variant="destructive">
    <UiAlertTitle>Couldn't load the review queue</UiAlertTitle>
    <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
  </UiAlert>
  <EmptyState
    v-else-if="!pending && !rows.length"
    icon="lucide:check-circle"
    title="Nothing waiting for review"
    description="Experiences appear here, oldest first, when providers send them for review."
  />
  <template v-else>
  <ol class="divide-border bg-card divide-y rounded-lg border">
    <li v-for="r in rows" :key="r.id" data-queue-item tabindex="-1" class="flex flex-wrap items-center justify-between gap-3 p-4 outline-none">
      <div class="min-w-0">
        <p class="font-medium">{{ r.title }}</p>
        <p class="text-muted-foreground text-sm">
          {{ r.provider?.display_name }} · {{ r.category?.name }}
          <template v-if="r.submitted_at"> · waiting {{ formatAge(r.submitted_at) }}</template>
        </p>
      </div>
      <UiButton size="sm" :to="`/listings/${r.id}`" :aria-label="`Review ${r.title}`">Review</UiButton>
    </li>
  </ol>
  <UiButton v-if="rows.length < total" variant="outline" class="mt-3" :disabled="loadingMore" @click="showMore">
    {{ loadingMore ? "Loading…" : `Show more (${total - rows.length} more waiting)` }}
  </UiButton>
  </template>
</template>
