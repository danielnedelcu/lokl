<script setup lang="ts">
import type { ListingKind, ListingStatus } from "@repo/types";

// All listings of one kind, a page at a time from the database
// (admin_listings_page), with the search, filters, page and sort in the URL
// (useServerTable). Admins read every listing, drafts included.
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
const statuses: { value: ListingStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "In review" },
  { value: "live", label: "Live" },
  { value: "rejected", label: "Needs changes" },
  { value: "unpublished", label: "Taken down" },
];
const shownStatuses = computed(() => statuses.filter((s) => props.kind === "experience" || !["submitted", "rejected"].includes(s.value)));

// The markets, for the city filter (a short list).
const { data: cities } = await useAsyncData("admin-listing-cities", async () => {
  const { data, error } = await supabase.from("cities").select("id, name").order("sort_order").order("name");
  if (error) throw error;
  return data;
});

const table = useServerTable({
  filters: { status: oneOf(...statuses.map((s) => s.value)), city: isUuid, provider: isUuid },
  sorts: ["updated", "title", "provider", "category", "city", "status", "price"],
  async load({ q, filters, page, sort, desc }, signal) {
    const { data, error } = await supabase
      .rpc("admin_listings_page", {
        p_kind: props.kind,
        p_q: q || undefined,
        p_status: filters.status,
        p_city_id: filters.city,
        p_provider_id: filters.provider,
        p_sort: sort,
        p_desc: desc,
        p_page: page,
      })
      .abortSignal(signal);
    return asServerPage<Row>(data, error);
  },
});
const f = computed(() => table.query.value.filters);
const picker = useProviderPicker(() => f.value.provider);

// Providers change their listings meanwhile: refresh when the tab is back in view.
useLiveData({ refresh: table.refresh });

const columns = [
  { accessorKey: "title", header: "Title", meta: { sortKey: "title" } },
  { id: "provider", header: "Provider", meta: { sortKey: "provider" } },
  { id: "category", header: "Category", meta: { sortKey: "category" } },
  { id: "city", header: "City", meta: { sortKey: "city" } },
  { accessorKey: "status", header: "Status", meta: { sortKey: "status" } },
  { accessorKey: "price_cents", header: props.kind === "experience" ? "Price per person" : "Price", meta: { sortKey: "price" } },
  { accessorKey: "updated_at", header: "Last changed", meta: { sortKey: "updated" } },
];
const plural = props.kind === "experience" ? "Experiences" : "Services";
</script>

<template>
  <div class="space-y-4">
    <form class="flex flex-wrap items-end gap-3" role="search" :aria-label="`Filter ${plural.toLowerCase()}`" @submit.prevent>
      <div>
        <UiLabel :for="`status-${kind}`" class="mb-2">Status</UiLabel>
        <SelectInput :id="`status-${kind}`" :model-value="f.status ?? ''" class="min-w-40"
          :options="[{ value: '', label: 'All statuses' }, ...shownStatuses]" @update:model-value="(v) => table.setFilter('status', v)" />
      </div>
      <div v-if="(cities?.length ?? 0) > 1">
        <UiLabel :for="`city-${kind}`" class="mb-2">City</UiLabel>
        <SelectInput :id="`city-${kind}`" :model-value="f.city ?? ''" class="min-w-40"
          :options="[{ value: '', label: 'All cities' }, ...(cities ?? []).map((c) => ({ value: c.id, label: c.name }))]"
          @update:model-value="(v) => table.setFilter('city', v)" />
      </div>
      <div class="w-56">
        <UiLabel :for="`provider-${kind}`" class="mb-2">Provider</UiLabel>
        <SearchSelect :id="`provider-${kind}`" :model-value="f.provider ?? ''" placeholder="All providers" empty-text="No provider matches."
          :options="[{ value: '', label: 'All providers' }]" :search="picker.search" :selected-label="picker.selectedLabel.value"
          @update:model-value="(v) => table.setFilter('provider', v)" />
      </div>
      <TableSearch :id="`search-${kind}`" :value="table.query.value.q" placeholder="Title or provider"
        hint="Matches the title or the provider's name. Results update as you type." @search="table.setSearch" />
    </form>

    <div class="flex flex-wrap items-center gap-x-3 text-sm">
      <p class="text-muted-foreground" aria-live="polite">
        {{ table.total.value.toLocaleString("en-US") }} {{ table.total.value === 1 ? plural.slice(0, -1).toLowerCase() : plural.toLowerCase() }}
      </p>
      <UiButton v-if="table.filtering.value" variant="link" size="sm" class="h-auto px-1" @click="table.clear()">Clear filters</UiButton>
    </div>

    <UiAlert v-if="table.error.value" variant="destructive">
      <UiAlertTitle>Couldn't load {{ plural.toLowerCase() }}</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!table.pending.value && !table.total.value && !table.filtering.value"
      :icon="kind === 'experience' ? 'lucide:compass' : 'lucide:wrench'" :title="`No ${plural.toLowerCase()} yet`"
      :description="`${plural} appear here as soon as providers start writing them, drafts included.`" />
    <EmptyState v-else-if="!table.pending.value && !table.total.value" icon="lucide:search-x"
      :title="`No ${plural.toLowerCase()} match these filters`" description="Try a different search, or clear the filters." />
    <UiCard v-else class="py-0">
      <ServerTable :rows="table.rows.value" :columns="columns" :total="table.total.value" :page="table.query.value.page"
        :sort="table.query.value.sort" :desc="table.query.value.desc" :pending="table.pending.value"
        @page="table.setPage" @sort="table.setSort">
        <template #title-cell="{ row }">
          <NuxtLink :to="`/listings/${row.original.id}`" class="font-medium underline-offset-4 hover:underline">
            {{ row.original.title }}
          </NuxtLink>
        </template>
        <template #provider-cell="{ row }">{{ row.original.provider?.display_name }}</template>
        <template #category-cell="{ row }">{{ row.original.category?.name }}</template>
        <template #city-cell="{ row }">{{ row.original.city?.name }}</template>
        <template #status-cell="{ row }">
          <StatusBadge kind="listing" :status="row.original.status" />
        </template>
        <template #price_cents-cell="{ row }">{{ formatMoney(row.original.price_cents) }}</template>
        <template #updated_at-cell="{ row }">
          <span class="text-muted-foreground">{{ formatDate(row.original.updated_at) }}</span>
        </template>
      </ServerTable>
    </UiCard>
  </div>
</template>
