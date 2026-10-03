<script setup lang="ts" generic="Row extends Record<string, any>">
import type { SortingState } from "@tanstack/vue-table";

// An admin table whose rows, paging and sorting come from the server
// (useServerTable): ui-thing's TanStack table in its manual modes, with the
// Pagination footer counting the server's total. Columns sort by their
// `meta.sortKey` (a key the database function accepts); columns without one
// can't be sorted.
const props = defineProps<{
  rows: Row[];
  columns: any[];
  total: number;
  page: number;
  sort: string;
  desc: boolean;
  pending: boolean;
  emptyText?: string;
}>();
const emit = defineEmits<{ page: [page: number]; sort: [sort: string, desc: boolean] }>();

// TanStack only sorts a column with a value accessor; the server does the
// sorting here, so a column drawn only through its slot gets a placeholder one.
const columns = computed(() =>
  props.columns.map((c) =>
    c.meta?.sortKey ? (c.accessorKey || c.accessorFn ? c : { ...c, accessorFn: () => null }) : { ...c, enableSorting: false },
  ),
);
const columnFor = (sortKey: string) => props.columns.find((c) => c.meta?.sortKey === sortKey);
const sortingState = computed<SortingState>(() => {
  const c = columnFor(props.sort);
  return c ? [{ id: c.id ?? c.accessorKey, desc: props.desc }] : [];
});
function onSorting(state: SortingState) {
  const first = state[0];
  if (!first) return emit("sort", props.sort, !props.desc);
  const c = props.columns.find((col) => (col.id ?? col.accessorKey) === first.id);
  if (c?.meta?.sortKey) emit("sort", c.meta.sortKey, first.desc);
}
</script>

<template>
  <UiTanStackTable :data="rows" :columns="columns" :loading="pending" manual-pagination manual-sorting
    :row-count="total" :page="page" :sorting-state="sortingState" :empty-text="emptyText"
    @update:pagination="(p) => p.pageIndex + 1 !== page && emit('page', p.pageIndex + 1)" @update:sorting="onSorting">
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope" />
    </template>
  </UiTanStackTable>
</template>
