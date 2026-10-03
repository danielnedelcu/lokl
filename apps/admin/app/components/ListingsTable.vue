<script setup lang="ts">
import type { ListingKind, ListingStatus } from "@repo/types";

// All listings of one kind, with filters. Admin RLS (listings_read_admin)
// lets the admin read every listing, so this reads from the page.
const props = defineProps<{ kind: ListingKind }>();

interface Row {
  id: string;
  title: string;
  status: ListingStatus;
  price_cents: number;
  updated_at: string;
  provider: { id: string; display_name: string } | null;
  category: { name: string } | null;
  city: { id: string; name: string } | null;
}

const supabase = useSupabaseClient();
const { data: rows, error, pending, refresh } = await useAsyncData(`admin-listings-${props.kind}`, async () => {
  const { data, error } = await supabase
    .from("listings")
    .select("id, title, status, price_cents, updated_at, provider:providers(id, display_name), category:categories(name), city:cities(id, name)")
    .eq("kind", props.kind)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as unknown as Row[];
});

// Providers change their listings meanwhile: refresh when the tab is back in view.
useLiveData({ refresh });

const statuses: { value: ListingStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "In review" },
  { value: "live", label: "Live" },
  { value: "rejected", label: "Needs changes" },
  { value: "unpublished", label: "Taken down" },
];
const shownStatuses = computed(() => statuses.filter((s) => props.kind === "experience" || !["submitted", "rejected"].includes(s.value)));

const search = ref("");
const status = ref("");
const cityId = ref("");
const providerId = ref("");

const uniqueBy = <T extends { id: string }>(items: (T | null)[]) =>
  [...new Map(items.filter((i): i is T => !!i).map((i) => [i.id, i])).values()];
const cities = computed(() => uniqueBy((rows.value ?? []).map((r) => r.city)).sort((a, b) => a.name.localeCompare(b.name)));
const providers = computed(() => uniqueBy((rows.value ?? []).map((r) => r.provider)).sort((a, b) => a.display_name.localeCompare(b.display_name)));

const filtered = computed(() =>
  (rows.value ?? []).filter(
    (r) =>
      (!status.value || r.status === status.value) &&
      (!cityId.value || r.city?.id === cityId.value) &&
      (!providerId.value || r.provider?.id === providerId.value) &&
      (!search.value.trim() || r.title.toLowerCase().includes(search.value.trim().toLowerCase())),
  ),
);
const filtering = computed(() => !!(search.value.trim() || status.value || cityId.value || providerId.value));
function clearFilters() {
  search.value = status.value = cityId.value = providerId.value = "";
}

const columns = [
  { accessorKey: "title", header: "Title" },
  { id: "provider", header: "Provider", accessorFn: (r: Row) => r.provider?.display_name ?? "" },
  { id: "category", header: "Category", accessorFn: (r: Row) => r.category?.name ?? "" },
  { id: "city", header: "City", accessorFn: (r: Row) => r.city?.name ?? "" },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "price_cents", header: props.kind === "experience" ? "Price per person" : "Price" },
  { accessorKey: "updated_at", header: "Last changed" },
];
const plural = props.kind === "experience" ? "Experiences" : "Services";
watch(error, (e) => e && reportProblem("Couldn't load listings", e), { immediate: true });
</script>

<template>
  <div class="space-y-4">
    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load {{ plural.toLowerCase() }}</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <template v-else>
      <div class="flex flex-wrap items-end gap-3" role="search" :aria-label="`Filter ${plural.toLowerCase()}`">
        <div class="w-full sm:w-64">
          <UiLabel :for="`search-${kind}`" class="mb-2">Title</UiLabel>
          <UiInput :id="`search-${kind}`" v-model="search" type="search" placeholder="Search by title" />
        </div>
        <div>
          <UiLabel :for="`status-${kind}`" class="mb-2">Status</UiLabel>
          <SelectInput :id="`status-${kind}`" v-model="status" class="min-w-40"
            :options="[{ value: '', label: 'All statuses' }, ...shownStatuses]" />
        </div>
        <div v-if="cities.length > 1">
          <UiLabel :for="`city-${kind}`" class="mb-2">City</UiLabel>
          <SelectInput :id="`city-${kind}`" v-model="cityId" class="min-w-40"
            :options="[{ value: '', label: 'All cities' }, ...cities.map((c) => ({ value: c.id, label: c.name }))]" />
        </div>
        <div>
          <UiLabel :for="`provider-${kind}`" class="mb-2">Provider</UiLabel>
          <SearchSelect :id="`provider-${kind}`" v-model="providerId" placeholder="All providers" empty-text="No provider matches."
            :options="[{ value: '', label: 'All providers' }, ...providers.map((p) => ({ value: p.id, label: p.display_name }))]" />
        </div>
        <UiButton v-if="filtering" variant="ghost" size="sm" @click="clearFilters">Clear filters</UiButton>
      </div>

      <EmptyState
        v-if="!pending && !rows?.length"
        :icon="kind === 'experience' ? 'lucide:compass' : 'lucide:wrench'"
        :title="`No ${plural.toLowerCase()} yet`"
        :description="`${plural} appear here as soon as providers start writing them, drafts included.`"
      />
      <EmptyState
        v-else-if="!pending && !filtered.length"
        icon="lucide:search-x"
        :title="`No ${plural.toLowerCase()} match these filters`"
        description="Try a different search, or clear the filters."
      />
      <UiCard v-else class="py-0">
        <UiTanStackTable
          :data="filtered"
          :columns="columns"
          :loading="pending"
        >
          <template #title-cell="{ row }">
            <NuxtLink :to="`/listings/${row.original.id}`" class="font-medium underline-offset-4 hover:underline">
              {{ row.original.title }}
            </NuxtLink>
          </template>
          <template #status-cell="{ row }">
            <StatusBadge kind="listing" :status="row.original.status" />
          </template>
          <template #price_cents-cell="{ row }">{{ formatMoney(row.original.price_cents) }}</template>
          <template #updated_at-cell="{ row }">
            <span class="text-muted-foreground">{{ formatDate(row.original.updated_at) }}</span>
          </template>
        </UiTanStackTable>
      </UiCard>
    </template>
  </div>
</template>
