<script setup lang="ts">
import {
  SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, SUPPORT_STATUSES, SUPPORT_STATUS_FOR_ADMIN, rpcJson,
  type AdminSupportCard, type AdminSupportColumn, type SupportCategory, type SupportStatus,
} from "@repo/types";

// Problem reports: the board (docs/design/problem-reports.md, The admin's
// side). Four columns from one database function (admin_support_board),
// each with its total and 50 cards, "Show more" for the next 50, so none
// stops quietly. Cards move with "Move to…" (the keyboard's and screen
// readers' way) or by dragging, which does exactly the same: the website's
// admin route, refused if someone else moved the card first. A move is
// announced, keeps focus on the card, and is undone if it doesn't save.
// Live: a new report or reply (the admin bell's notification, ids only)
// reloads the board.
definePageMeta({ title: "Problem reports" });
useSeoMeta({ title: "Problem reports" });

const PAGE_SIZE = 50;
const route = useRoute();
const router = useRouter();
const supabase = useSupabaseClient();
const website = useWebsiteAdmin();

// Filters, in the address.
const category = computed(() => (SUPPORT_CATEGORIES.includes(route.query.category as SupportCategory) ? (route.query.category as SupportCategory) : null));
const urgentOnly = computed(() => route.query.urgent === "1");
const q = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const allDone = computed(() => route.query.done === "all");
function setFilter(key: string, value: string | null) {
  void router.replace({ query: { ...route.query, [key]: value || undefined } });
}
const categoryOptions = [{ value: null, label: "Every category" }, ...SUPPORT_CATEGORIES.map((c) => ({ value: c, label: SUPPORT_CATEGORY_LABELS[c] }))];

type Columns = Record<SupportStatus, AdminSupportColumn>;
async function fetchBoard(column?: SupportStatus, page = 1) {
  const { data, error } = await supabase.rpc("admin_support_board", {
    p_category: category.value ?? undefined, p_urgent_only: urgentOnly.value, p_q: q.value || undefined,
    p_done_days: allDone.value ? undefined : 30, p_column: column, p_page: page, p_page_size: PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  return rpcJson("admin_support_board", data).columns;
}

const columns = ref<Columns | null>(null);
const pages = reactive<Record<SupportStatus, number>>({ todo: 1, in_progress: 1, waiting: 1, done: 1 });
const loadError = ref(false);
async function load() {
  try {
    const c = await fetchBoard();
    columns.value = { todo: c.todo!, in_progress: c.in_progress!, waiting: c.waiting!, done: c.done! };
    for (const s of SUPPORT_STATUSES) pages[s] = 1;
    loadError.value = false;
  } catch (e) {
    console.error("[reports] board", e);
    loadError.value = true;
  }
}
watch([category, urgentOnly, q, allDone], () => void load());
await load();
useLiveData({ refresh: load });
onSupportReportChanged(() => void load());

// "Show more": the column's next page, added below.
const loadingMore = ref<SupportStatus | null>(null);
async function showMore(status: SupportStatus) {
  if (!columns.value) return;
  loadingMore.value = status;
  const firstNew = columns.value[status].rows.length;
  try {
    const c = (await fetchBoard(status, pages[status] + 1))[status]!;
    columns.value[status].rows.push(...c.rows.filter((r) => !columns.value![status].rows.some((x) => x.id === r.id)));
    columns.value[status].total = c.total;
    pages[status] += 1;
    await nextTick();
    document.querySelectorAll<HTMLElement>(`[data-column="${status}"] [data-card]`)[firstNew]?.focus();
  } catch {
    announce("More reports didn't load. Try again.");
  } finally {
    loadingMore.value = null;
  }
}

// Moving a card.
const announcement = ref("");
function announce(text: string) {
  // Cleared first, so the same words are announced again.
  announcement.value = "";
  void nextTick(() => (announcement.value = text));
}
const cardName = (c: AdminSupportCard) => `${SUPPORT_CATEGORY_LABELS[c.category]} from ${c.provider.name}`;
const moving = ref<string | null>(null);
async function move(card: AdminSupportCard, from: SupportStatus, to: SupportStatus) {
  if (!columns.value || from === to || moving.value) return;
  moving.value = card.id;
  // At once on screen; put back if it doesn't save.
  const source = columns.value[from];
  const target = columns.value[to];
  const at = source.rows.findIndex((r) => r.id === card.id);
  source.rows.splice(at, 1);
  source.total -= 1;
  target.rows.unshift(card);
  target.total += 1;
  await nextTick();
  focusCard(card.id);
  try {
    await website(`support-reports/${card.id}/status`, { to, from });
    announce(`Moved "${cardName(card)}" to ${SUPPORT_STATUS_FOR_ADMIN[to]}.`);
  } catch (e) {
    target.rows.splice(target.rows.findIndex((r) => r.id === card.id), 1);
    target.total -= 1;
    source.rows.splice(at, 0, card);
    source.total += 1;
    await nextTick();
    focusCard(card.id);
    announce(`That didn't save. The report is still in ${SUPPORT_STATUS_FOR_ADMIN[from]}. ${(e as Error).message}`);
    // Someone else may have moved it: show where it really is.
    await load();
    focusCard(card.id);
  } finally {
    moving.value = null;
  }
}
function focusCard(id: string) {
  document.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus();
}

// Drag and drop, for a mouse: the same move as the menu.
const dragging = ref<{ card: AdminSupportCard; from: SupportStatus } | null>(null);
const dropTarget = ref<SupportStatus | null>(null);
function onDragStart(e: DragEvent, card: AdminSupportCard, from: SupportStatus) {
  dragging.value = { card, from };
  e.dataTransfer?.setData("text/plain", card.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onDrop(to: SupportStatus) {
  const d = dragging.value;
  dragging.value = null;
  dropTarget.value = null;
  if (d) void move(d.card, d.from, to);
}

/** "Provider replied 2 hours ago", "lokl replied 3 days ago", "Sent 5 hours ago". */
function lastLine(c: AdminSupportCard) {
  if (c.last_message_at === c.created_at) return `Sent ${formatAge(c.created_at)} ago`;
  return `${c.last_message_from === "provider" ? "Provider" : "lokl"} replied ${formatAge(c.last_message_at)} ago`;
}
// Each column's icon (and Done's light tint). The name and count are always
// in words too, so nothing depends on the colour.
const COLUMN_STYLE: Record<SupportStatus, { icon: string; header: string }> = {
  todo: { icon: "lucide:circle-dashed", header: "" },
  in_progress: { icon: "lucide:circle-dot", header: "" },
  waiting: { icon: "lucide:hourglass", header: "" },
  done: { icon: "lucide:circle-check", header: "bg-success/10" },
};
const reportsWord = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "report" : "reports"}`;
</script>

<template>
  <div>
    <PageHeader title="Problem reports" description="What providers have reported. Safety reports are marked Urgent and come first." />

    <div class="mb-6 flex flex-wrap items-end gap-4">
      <div class="w-full sm:w-56">
        <UiLabel for="filter-category" class="mb-1">Category</UiLabel>
        <SelectInput id="filter-category" :model-value="category" :options="categoryOptions" @update:model-value="(v) => setFilter('category', v ?? null)" />
      </div>
      <label class="flex min-h-9 items-center gap-2 text-sm">
        <UiCheckbox :model-value="urgentOnly" @update:model-value="(v) => setFilter('urgent', v ? '1' : null)" />
        Urgent only
      </label>
      <TableSearch :value="q" placeholder="Business or what happened" @search="(v) => setFilter('q', v)" />
    </div>

    <UiAlert v-if="loadError" variant="destructive" icon="lucide:alert-circle" class="mb-6">
      <UiAlertTitle>The board didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>

    <!-- The board: four columns side by side, scrolling sideways when the
         screen is narrower (focusable, so the keyboard can scroll it). -->
    <div v-if="columns" tabindex="0" aria-label="Problem reports board"
      class="focus-visible:ring-ring/50 -mx-4 overflow-x-auto px-4 pb-4 outline-none focus-visible:ring-[3px] md:-mx-8 md:px-8">
      <div class="flex items-start gap-4">
        <section v-for="status in SUPPORT_STATUSES" :key="status" :data-column="status" :aria-labelledby="`col-${status}`"
          class="border-border flex min-w-62 flex-1 flex-col rounded-2xl border p-2 transition-colors"
          :class="dropTarget === status && dragging && dragging.from !== status ? 'bg-muted' : 'bg-background'"
          @dragover.prevent="dropTarget = status" @dragleave="dropTarget = dropTarget === status ? null : dropTarget" @drop.prevent="onDrop(status)">
          <header class="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2" :class="COLUMN_STYLE[status].header">
            <!-- aria-label: the count in words, with no stray space before the comma. -->
            <h2 :id="`col-${status}`" :aria-label="`${SUPPORT_STATUS_FOR_ADMIN[status]}, ${reportsWord(columns[status].total)}`"
              class="flex items-center gap-2 text-base font-semibold">
              <Icon :name="COLUMN_STYLE[status].icon" class="size-4" aria-hidden="true" />
              {{ SUPPORT_STATUS_FOR_ADMIN[status] }}
            </h2>
            <span aria-hidden="true" class="bg-background border-border min-w-8 rounded-lg border px-2 py-0.5 text-center text-sm font-semibold tabular-nums shadow-xs">
              {{ columns[status].total.toLocaleString("en-US") }}
            </span>
          </header>
          <p v-if="status === 'done'" class="text-muted-foreground px-1 pt-2 text-xs">
            {{ allDone ? "Every report done." : "Done in the last 30 days." }}
            <button type="button" class="link-text" @click="setFilter('done', allDone ? null : 'all')">{{ allDone ? "Last 30 days only" : "See all done" }}</button>
          </p>

          <ul class="mt-2 space-y-2">
            <li v-for="card in columns[status].rows" :key="card.id" :data-card="card.id" tabindex="-1" draggable="true"
              class="bg-card border-border focus-visible:ring-ring/50 cursor-grab rounded-xl border shadow-xs outline-none focus-visible:ring-[3px] active:cursor-grabbing"
              :class="dragging?.card.id === card.id && 'opacity-50'"
              @dragstart="onDragStart($event, card, status)" @dragend="dragging = null; dropTarget = null">
              <div class="p-3.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <UiBadge v-if="card.urgent" variant="destructive"><Icon name="lucide:siren" class="size-3" aria-hidden="true" />Urgent</UiBadge>
                  <span class="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium">{{ SUPPORT_CATEGORY_LABELS[card.category] }}</span>
                </div>
                <h3 class="mt-3 font-semibold leading-snug">
                  <NuxtLink :to="`/reports/${card.id}`" class="hover:underline"><span class="sr-only">{{ SUPPORT_CATEGORY_LABELS[card.category] }} from </span>{{ card.provider.name }}</NuxtLink>
                </h3>
                <p class="text-muted-foreground mt-0.5 text-sm">{{ lastLine(card) }}</p>
                <p class="border-border text-muted-foreground mt-3 line-clamp-2 border-t border-dashed pt-3 text-sm">{{ card.excerpt }}</p>
              </div>
              <div class="border-border flex items-center justify-end border-t px-3.5 py-2">
                <UiDropdownMenu>
                  <UiDropdownMenuTrigger as-child>
                    <UiButton variant="outline" size="sm" :disabled="moving === card.id" :aria-label="`Move to… (${cardName(card)})`">
                      <Icon name="lucide:arrow-right-left" class="size-3.5" aria-hidden="true" />Move to…
                    </UiButton>
                  </UiDropdownMenuTrigger>
                  <UiDropdownMenuContent align="end">
                    <UiDropdownMenuItem v-for="to in SUPPORT_STATUSES.filter((s) => s !== status)" :key="to" @select="move(card, status, to)">
                      <Icon :name="COLUMN_STYLE[to].icon" class="size-4" aria-hidden="true" />{{ SUPPORT_STATUS_FOR_ADMIN[to] }}
                    </UiDropdownMenuItem>
                  </UiDropdownMenuContent>
                </UiDropdownMenu>
              </div>
            </li>
          </ul>
          <p v-if="!columns[status].rows.length" class="border-border text-muted-foreground mt-2 rounded-xl border border-dashed p-6 text-center text-sm">
            No reports here.
          </p>

          <div v-if="columns[status].rows.length < columns[status].total" class="mt-2">
            <UiButton variant="ghost" class="border-border w-full border border-dashed" :disabled="loadingMore === status" @click="showMore(status)">
              <Icon name="lucide:chevrons-down" class="size-4" aria-hidden="true" />
              {{ loadingMore === status ? "Loading…" : "Show more" }}<span class="sr-only"> in {{ SUPPORT_STATUS_FOR_ADMIN[status] }}</span>
            </UiButton>
            <p class="text-muted-foreground mt-1.5 text-center text-xs">Showing {{ columns[status].rows.length.toLocaleString("en-US") }} of {{ columns[status].total.toLocaleString("en-US") }}</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
