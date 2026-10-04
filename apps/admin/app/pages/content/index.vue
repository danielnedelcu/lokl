<script setup lang="ts">
import { guideState, type Guide } from "@repo/types";

// Every destination guide, drafts included (docs/design/destination-guides.md,
// What the admin app needs). "New guide" creates an empty guide straight
// away, with a placeholder address that follows its title (guideSlug.ts),
// and opens the editor; with more than one city, it asks which first.
useHead({ title: "Destination guides" });
const supabase = useSupabaseClient();

type Row = Guide & { market: { name: string; slug: string } | null };

const { data: markets } = await useAsyncData("admin-guide-markets", async () => {
  const { data, error } = await supabase.from("cities").select("id, name").eq("active", true).order("sort_order").order("name");
  if (error) throw error;
  return data;
});

// AI drafting this month (the cost log, guide_ai_drafts), in the viewer's time zone.
const { data: aiMonth } = await useAsyncData("admin-guide-ai-month", async () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data, error } = await supabase.from("guide_ai_drafts").select("cost_usd").gte("created_at", monthStart);
  if (error) {
    reportProblem("Couldn't load this month's AI drafting cost", error);
    return null;
  }
  return { count: data.length, cents: Math.round(data.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0) * 100) };
});

// ---------------------------------------------------------------------------
// The list, by tab: All, Published (live on the site, with or without
// changes waiting) and Draft (not live: never published, or unpublished).
// ---------------------------------------------------------------------------

// From the database a page at a time, newest edit first, like the other
// admin tables (useServerTable): the tab, search and page are in the URL.
// The search matches the title (the draft's, which is what the list shows),
// in the database, not in the page. Admins read guides under RLS; the
// guides table is small enough not to need a page function.
type Tab = "all" | "published" | "draft";
const PAGE_SIZE = 25;
/** The search as an ILIKE pattern: % and _ in what was typed match themselves. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const table = useServerTable({
  filters: { status: oneOf("published", "draft") },
  sorts: ["updated"],
  async load({ q, filters, page }, signal) {
    let query = supabase.from("guides").select("*, market:cities(name, slug)", { count: "exact" });
    if (filters.status === "published") query = query.eq("status", "published");
    if (filters.status === "draft") query = query.neq("status", "published");
    if (q) query = query.ilike("draft_title", likePattern(q));
    const from = (page - 1) * PAGE_SIZE;
    const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, from + PAGE_SIZE - 1).abortSignal(signal);
    if (error) throw error;
    return { rows: data as unknown as Row[], total: count ?? 0, total_exact: true };
  },
});
const tab = computed<Tab>(() => (table.query.value.filters.status as Tab | undefined) ?? "all");
const setTab = (t: string | number) => table.setFilter("status", t === "all" ? null : String(t));

// The count on each tab, for the current search.
const counts = ref<Record<Tab, number | null>>({ all: null, published: null, draft: null });
async function loadCounts() {
  const q = table.query.value.q;
  const count = async (t: Tab) => {
    let query = supabase.from("guides").select("id", { count: "exact", head: true });
    if (t === "published") query = query.eq("status", "published");
    if (t === "draft") query = query.neq("status", "published");
    if (q) query = query.ilike("draft_title", likePattern(q));
    const { count: n, error } = await query;
    return error ? null : (n ?? 0);
  };
  const [all, published, draft] = await Promise.all([count("all"), count("published"), count("draft")]);
  counts.value = { all, published, draft };
}
watch(() => table.query.value.q, () => void loadCounts(), { immediate: true });

// Empty drafts left by a closed tab (the editor discards the rest itself).
onMounted(async () => {
  if (await removeAbandonedDrafts(supabase)) await Promise.all([table.refresh(), loadCounts()]);
});

const isLive = (r: Row) => r.status === "published";
const tabs: { value: Tab; label: string; empty: string }[] = [
  { value: "all", label: "All", empty: "No guides yet. Start with “New guide”." },
  { value: "published", label: "Published", empty: "No guides are live yet." },
  { value: "draft", label: "Draft", empty: "No drafts. Every guide is live." },
];
const titleOf = (r: Row) => r.draft_title || r.title || "Untitled guide";

// View: a live guide opens on the website (new tab); any other, the admin's preview of its draft.
const websiteUrl = useRuntimeConfig().public.websiteUrl.replace(/\/$/, "");
const viewLink = (r: Row) =>
  isLive(r) && r.market ? { to: `${websiteUrl}/${r.market.slug}/guides/${r.slug}`, external: true } : { to: `/content/${r.id}/preview`, external: false };

// Delete: only a guide that's never been published (the database refuses
// the rest: their address is in search results). Asks first. Which guide is
// kept apart from whether the dialog is open: the dialog's Delete button
// closes it before its click handler runs, and clearing the guide on close
// made the delete do nothing (found 2026-10-04).
const deleteOpen = ref(false);
const deleting = ref<{ id: string; title: string } | null>(null);
const deleteBusy = ref(false);
function askDelete(r: Row) {
  deleting.value = { id: r.id, title: titleOf(r) };
  deleteOpen.value = true;
}
async function confirmDelete() {
  const row = deleting.value;
  if (!row || deleteBusy.value) return;
  deleteBusy.value = true;
  const e = await deleteGuideWithPhotos(supabase, row.id);
  deleteBusy.value = false;
  deleteOpen.value = false;
  if (e) return void useSonner.error(reportProblem(problemText(e, "The guide wasn't deleted. Try again."), e));
  useSonner.success(`Deleted “${row.title}”.`);
  await Promise.all([table.refresh(), loadCounts()]);
}

// ---------------------------------------------------------------------------
// New guide
// ---------------------------------------------------------------------------

const creating = ref(false);
async function createGuide(marketId: string | undefined) {
  if (!marketId) return void useSonner.error("Add a city first (Cities), then create a guide for it.");
  creating.value = true;
  // A placeholder address can collide only by chance: try again once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error: e } = await supabase.from("guides").insert({ market_id: marketId, slug: newGuideSlug() }).select("id").single();
    if (e?.code === "23505") continue;
    creating.value = false;
    if (e) return void useSonner.error(reportProblem("The guide wasn't created. Try again.", e));
    return void (await navigateTo(`/content/${data.id}`));
  }
  creating.value = false;
  useSonner.error("The guide wasn't created. Try again.");
}
</script>

<template>
  <div>
    <PageHeader title="Destination guides"
      description="Articles about places and themes in each city, each showing matching live listings.">
      <template #actions>
        <UiDropdownMenu v-if="(markets?.length ?? 0) > 1">
          <UiDropdownMenuTrigger as-child>
            <UiButton size="sm" :disabled="creating">
              <Icon name="lucide:plus" aria-hidden="true" />New guide<Icon name="lucide:chevron-down" aria-hidden="true" />
            </UiButton>
          </UiDropdownMenuTrigger>
          <UiDropdownMenuContent align="end">
            <UiDropdownMenuLabel class="text-muted-foreground font-normal">Which city is it for?</UiDropdownMenuLabel>
            <UiDropdownMenuItem v-for="m in markets" :key="m.id" @select="createGuide(m.id)">{{ m.name }}</UiDropdownMenuItem>
          </UiDropdownMenuContent>
        </UiDropdownMenu>
        <UiButton v-else size="sm" :disabled="creating" @click="createGuide(markets?.[0]?.id)">
          <Icon :name="creating ? 'lucide:loader-circle' : 'lucide:plus'" :class="creating && 'animate-spin'" aria-hidden="true" />
          {{ creating ? "Creating…" : "New guide" }}
        </UiButton>
      </template>
    </PageHeader>

    <p v-if="aiMonth?.count" class="text-muted-foreground mb-4 flex items-center gap-1 text-sm">
      <Icon name="lucide:sparkles" aria-hidden="true" />
      AI drafting this month: {{ formatMoney(aiMonth.cents) }} ({{ aiMonth.count }} {{ aiMonth.count === 1 ? "draft" : "drafts" }})
    </p>

    <UiTabs :model-value="tab" @update:model-value="setTab">
      <div class="flex flex-wrap items-end gap-3">
        <UiTabsList aria-label="Which guides">
          <UiTabsTrigger v-for="t in tabs" :key="t.value" :value="t.value">
            {{ t.label }} <span v-if="counts[t.value] != null" class="text-muted-foreground ml-1 tabular-nums">{{ counts[t.value] }}</span>
          </UiTabsTrigger>
        </UiTabsList>
        <TableSearch id="guide-search" :value="table.query.value.q" placeholder="Search by title"
          hint="Matches the guide's title. Results update as you type." @search="table.setSearch" />
      </div>

      <UiTabsContent v-for="t in tabs" :key="t.value" :value="t.value" class="mt-4">
        <UiAlert v-if="table.error.value" variant="destructive">
          <UiAlertTitle>Couldn't load guides</UiAlertTitle>
          <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
        </UiAlert>
        <p v-else-if="!table.pending.value && !table.rows.value.length"
          class="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
          {{ table.query.value.q ? "No guide title matches that search." : t.empty }}
        </p>
        <template v-else>
          <ul class="divide-border bg-card divide-y rounded-lg border" :aria-busy="table.pending.value || undefined"
            :class="table.pending.value && 'opacity-60'">
            <li v-for="r in table.rows.value" :key="r.id" class="group hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors">
              <Icon name="lucide:file-text" class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <NuxtLink :to="`/content/${r.id}`" class="min-w-0 truncate font-medium">{{ titleOf(r) }}</NuxtLink>
                  <StatusBadge kind="guide" :status="guideState(r)" class="shrink-0" />
                </div>
                <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span>Last edited {{ formatDate(r.updated_at) }}</span>
                  <span>{{ r.market?.name ?? "" }}</span>
                </p>
              </div>
              <!-- Always visible on touch screens; on larger screens, on hover or keyboard focus. -->
              <div class="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <UiTooltip>
                  <UiTooltipTrigger as-child>
                    <UiButton as-child size="icon-sm" variant="ghost">
                      <NuxtLink :to="`/content/${r.id}`" :aria-label="`Edit post: ${titleOf(r)}`">
                        <Icon name="lucide:pencil" aria-hidden="true" />
                      </NuxtLink>
                    </UiButton>
                  </UiTooltipTrigger>
                  <UiTooltipContent>Edit post</UiTooltipContent>
                </UiTooltip>
                <UiTooltip>
                  <UiTooltipTrigger as-child>
                    <UiButton as-child size="icon-sm" variant="ghost">
                      <NuxtLink :to="viewLink(r).to" :external="viewLink(r).external" :target="viewLink(r).external ? '_blank' : undefined"
                        :aria-label="`View post: ${titleOf(r)}${viewLink(r).external ? ' (opens the website in a new tab)' : ''}`">
                        <Icon name="lucide:eye" aria-hidden="true" />
                      </NuxtLink>
                    </UiButton>
                  </UiTooltipTrigger>
                  <UiTooltipContent>View post</UiTooltipContent>
                </UiTooltip>
                <UiTooltip v-if="!r.published_at">
                  <UiTooltipTrigger as-child>
                    <UiButton size="icon-sm" variant="ghost" class="hover:text-destructive" :aria-label="`Delete post: ${titleOf(r)}`"
                      @click="askDelete(r)">
                      <Icon name="lucide:trash-2" aria-hidden="true" />
                    </UiButton>
                  </UiTooltipTrigger>
                  <UiTooltipContent>Delete post</UiTooltipContent>
                </UiTooltip>
                <!-- Keeps the icons lined up on rows that can't be deleted. -->
                <span v-else class="size-8" aria-hidden="true" />
              </div>
            </li>
          </ul>
          <!-- More than one page: the same page controls as the admin tables (25 a page). -->
          <UiPagination v-if="table.total.value > PAGE_SIZE" class="mt-4" aria-label="Guide pages" :page="table.query.value.page"
            :total="table.total.value" :items-per-page="PAGE_SIZE" :sibling-count="1" show-edges @update:page="table.setPage" />
        </template>
      </UiTabsContent>
    </UiTabs>

    <UiAlertDialog v-model:open="deleteOpen" title="Delete this guide?"
      :description="`“${deleting?.title ?? ''}” and its photos are deleted. This can't be undone.`">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiAlertDialogAction text="Delete guide" variant="destructive" :disabled="deleteBusy" @click.prevent="confirmDelete" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>

  </div>
</template>
