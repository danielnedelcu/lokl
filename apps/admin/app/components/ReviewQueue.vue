<script setup lang="ts">
// Experiences waiting for review, oldest first (design: Review queue).
const emit = defineEmits<{ count: [n: number] }>();

interface Row {
  id: string;
  title: string;
  submitted_at: string | null;
  provider: { display_name: string } | null;
  category: { name: string } | null;
}

const supabase = useSupabaseClient();
const { data: rows, error, pending, refresh } = await useAsyncData("admin-review-queue", async () => {
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, submitted_at, provider:providers(display_name), category:categories(name)")
    .eq("kind", "experience")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return data as unknown as Row[];
});
watchEffect(() => emit("count", rows.value?.length ?? 0));
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
    v-else-if="!pending && !rows?.length"
    icon="lucide:check-circle"
    title="Nothing waiting for review"
    description="Experiences appear here, oldest first, when providers send them for review."
  />
  <ol v-else class="divide-border bg-card divide-y rounded-lg border">
    <li v-for="r in rows" :key="r.id" class="flex flex-wrap items-center justify-between gap-3 p-4">
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
</template>
