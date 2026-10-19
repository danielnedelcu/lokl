<script setup lang="ts">
import type { HomepageGuide, PublicGuidePhoto } from "@repo/types";

// The owner's alone (docs/design/admin-roles.md); the database refuses support's writes too.
definePageMeta({ ownerOnly: true });

// Which guides are on the homepage (docs/design/destination-guides.md, The
// homepage; three places since 2026-10-11): a main guide, alone at the top,
// and up to two more in the guides section below "On lokl now". Never the
// same guide twice, and no cards without a main guide (the database refuses
// both, and shows no guides without a main guide it can show). Saved in one
// step (admin_set_homepage_features: the main guide first), so the homepage
// is never half-changed. The preview uses the website's own components, in
// the homepage's order.
useHead({ title: "Homepage · Admin" });
const supabase = useSupabaseClient();
const websiteUrl = useRuntimeConfig().public.websiteUrl.replace(/\/$/, "");
const MAX_CARDS = 2;

interface Choice {
  id: string;
  title: string;
  teaser: string;
  market: string;
  marketName: string;
  marketOpen: boolean;
  slug: string;
  cover: PublicGuidePhoto | null;
}

const { data, error, refresh } = await useAsyncData("admin-homepage", async () => {
  const [guides, features] = await Promise.all([
    // Every published guide, a page of 1,000 at a time (utils/adminLists.ts).
    publishedGuides(supabase),
    // bounded: three places at most
    supabase.from("homepage_features").select("position, guide_id").order("position"),
  ]);
  if (features.error) throw features.error;
  const published: Choice[] = guides.map((g) => ({
    id: g.id,
    title: g.title ?? "",
    teaser: g.teaser ?? "",
    slug: g.slug,
    market: g.market?.slug ?? "",
    marketName: g.market?.name ?? "",
    marketOpen: !!g.market?.active,
    cover: g.cover
      ? { id: g.cover.id, path: g.cover.storage_path, card_path: g.cover.card_path, width: g.cover.width, height: g.cover.height,
          alt: g.cover.alt_text, source: g.cover.source, credit_name: g.cover.credit_name, credit_url: g.cover.credit_url,
          source_url: g.cover.source_url, licence: g.cover.licence }
      : null,
  }));
  const rows = features.data ?? [];
  return {
    published,
    savedMain: rows.find((f) => f.position === 1)?.guide_id ?? null,
    savedCards: rows.filter((f) => f.position > 1).map((f) => f.guide_id),
  };
});
watch(error, (e) => e && reportProblem("Couldn't load the homepage guides", e), { immediate: true });

// What's being edited, starting from what's saved.
const main = ref<string | null>(null);
const cards = ref<string[]>([]);
function reset() {
  main.value = data.value?.savedMain ?? null;
  cards.value = [...(data.value?.savedCards ?? [])];
}
watch(data, reset, { immediate: true });
const byId = computed(() => new Map((data.value?.published ?? []).map((g) => [g.id, g])));
const mainGuide = computed(() => (main.value ? byId.value.get(main.value) ?? null : null));
const cardRows = computed(() => cards.value.map((id) => byId.value.get(id)).filter((g): g is Choice => !!g));
const chosenIds = computed(() => [main.value, ...cards.value].filter((id): id is string => !!id));
const toSave = computed(() => (main.value ? [main.value, ...cards.value] : []));
const changed = computed(() => main.value !== (data.value?.savedMain ?? null) || JSON.stringify(cards.value) !== JSON.stringify(data.value?.savedCards ?? []));
// Never the same guide twice: each field offers only guides not used anywhere.
const unused = computed(() => (data.value?.published ?? []).filter((g) => !chosenIds.value.includes(g.id)));

// Problems with what's saved, said in words.
const savedMainGuide = computed(() => (data.value?.savedMain ? byId.value.get(data.value.savedMain) ?? null : null));
const mainUnpublished = computed(() => !data.value?.savedMain && (data.value?.savedCards.length ?? 0) > 0);
const mainMarketClosed = computed(() => !!savedMainGuide.value && !savedMainGuide.value.marketOpen);
// No cards without a main guide.
const cannotSave = computed(() => !main.value && cards.value.length > 0);

// Announced to screen readers after a change on this page.
const status = ref("");

// The main guide: choose, replace or clear.
const choosingMain = ref(false);
const mainPick = ref<string | null>("");
function setMain() {
  if (!mainPick.value) return;
  main.value = mainPick.value;
  mainPick.value = "";
  choosingMain.value = false;
  status.value = `${byId.value.get(main.value)?.title ?? "The guide"} is the main guide.`;
}
function clearMain() {
  main.value = null;
  choosingMain.value = false;
  status.value = "Main guide cleared.";
}

// More guides: add, reorder, remove.
const cardPick = ref<string | null>("");
function addCard() {
  if (!cardPick.value || !main.value || cards.value.length >= MAX_CARDS) return;
  cards.value = [...cards.value, cardPick.value];
  status.value = `${byId.value.get(cardPick.value)?.title ?? "The guide"} added as card ${cards.value.length}.`;
  cardPick.value = "";
}
const cardList = useTemplateRef<HTMLElement>("cardList");
async function move(i: number, dir: -1 | 1) {
  const next = [...cards.value];
  const id = next[i]!;
  [next[i], next[i + dir]] = [next[i + dir]!, next[i]!];
  cards.value = next;
  const to = i + dir;
  status.value = `Moved ${byId.value.get(id)?.title ?? "the guide"} to card ${to + 1}.`;
  // Keep focus on the moved row: the same button, or, if that one is now
  // disabled (the end of the list), the row's other move button.
  await nextTick();
  const pressed = cardList.value?.querySelector<HTMLButtonElement>(`[data-move="${dir < 0 ? "up" : "down"}-${id}"]`);
  const other = cardList.value?.querySelector<HTMLButtonElement>(`[data-move="${dir < 0 ? "down" : "up"}-${id}"]`);
  (pressed && !pressed.disabled ? pressed : other)?.focus();
}
function removeCard(i: number) {
  const title = cardRows.value[i]?.title ?? "The guide";
  cards.value = cards.value.filter((_, j) => j !== i);
  status.value = `${title} removed from the homepage.`;
}

const saving = ref(false);
async function save() {
  if (cannotSave.value) return;
  saving.value = true;
  const { error: e } = await supabase.rpc("admin_set_homepage_features", { p_guide_ids: toSave.value });
  saving.value = false;
  if (e) {
    const plain = e.message.startsWith("Only a published") || e.message.startsWith("The homepage shows") || e.message.startsWith("Each guide");
    return void useSonner.error(reportProblem(plain ? e.message : "The homepage wasn't saved. Try again.", e));
  }
  useSonner.success(toSave.value.length ? "Saved. The homepage shows these now." : "Saved. The homepage shows its headline first again.");
  await refresh();
}

const asHomepage = (g: Choice, position: number): HomepageGuide | null =>
  g.cover ? { position, market: g.market, slug: g.slug, title: g.title, teaser: g.teaser, cover: g.cover } : null;
const previewMain = computed(() => (mainGuide.value ? asHomepage(mainGuide.value, 1) : null));
const previewCards = computed(() => cardRows.value.map((g, i) => asHomepage(g, i + 2)).filter((g): g is HomepageGuide => !!g));
</script>

<template>
  <div>
    <PageHeader title="Homepage"
      description="A main guide alone at the top of the homepage, then up to two more in the guides section below “On lokl now”." />

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load the homepage guides</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="data && !data.published.length" icon="lucide:house" title="No published guides yet"
      description="Publish a guide first, then choose it here to lead the homepage." />

    <div v-else-if="data" class="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div class="space-y-8">
        <UiAlert v-if="mainUnpublished" variant="destructive">
          <Icon name="lucide:circle-alert" aria-hidden="true" />
          <UiAlertTitle>No main guide</UiAlertTitle>
          <UiAlertDescription>The main guide was unpublished, so the homepage shows no guides until you choose one.</UiAlertDescription>
        </UiAlert>
        <UiAlert v-else-if="mainMarketClosed" variant="destructive">
          <Icon name="lucide:circle-alert" aria-hidden="true" />
          <UiAlertTitle>Main guide's market closed</UiAlertTitle>
          <UiAlertDescription>The main guide's market is closed, so visitors see no guides. Choose a guide from an open market.</UiAlertDescription>
        </UiAlert>

        <section aria-labelledby="main-heading" class="space-y-3">
          <h2 id="main-heading" class="font-medium">Main guide</h2>
          <div v-if="mainGuide && !choosingMain" class="flex items-center gap-2 rounded-lg border p-3">
            <UiBadge class="shrink-0">Main</UiBadge>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ mainGuide.title }}</span>
            <UiButton size="sm" variant="ghost" :aria-label="`Replace the main guide (${mainGuide.title})`" @click="choosingMain = true">Replace</UiButton>
            <UiButton size="sm" variant="ghost" :aria-label="`Clear the main guide (${mainGuide.title})`" @click="clearMain">Clear</UiButton>
          </div>
          <form v-else class="flex items-end gap-2" @submit.prevent="setMain">
            <div class="min-w-0 flex-1">
              <UiLabel for="main-guide" class="mb-1">Choose the main guide</UiLabel>
              <SearchSelect id="main-guide" v-model="mainPick" placeholder="Choose a published guide" empty-text="No other published guide matches."
                :options="unused.map((g) => ({ value: g.id, label: g.title }))" />
            </div>
            <UiButton type="submit" variant="outline" :disabled="!mainPick">{{ mainGuide ? "Replace" : "Choose" }}</UiButton>
            <UiButton v-if="mainGuide" type="button" variant="ghost" @click="choosingMain = false">Keep it</UiButton>
          </form>
        </section>

        <section aria-labelledby="cards-heading" class="space-y-3">
          <h2 id="cards-heading" class="font-medium">More guides ({{ cards.length }} of {{ MAX_CARDS }})</h2>
          <p class="text-muted-foreground text-sm">In the guides section below “On lokl now”, in this order.</p>
          <p v-if="!cardRows.length" class="border-border rounded-md border border-dashed p-4 text-sm">
            None chosen. The guides section shows its text and “See all guides”.
          </p>
          <ol v-else ref="cardList" class="divide-border divide-y rounded-lg border">
            <li v-for="(g, i) in cardRows" :key="g.id" class="flex items-center gap-2 p-3">
              <UiBadge variant="outline" class="shrink-0">Card {{ i + 1 }}</UiBadge>
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ g.title }}</span>
              <UiButton size="icon-sm" variant="ghost" :data-move="`up-${g.id}`" :disabled="i === 0"
                :aria-label="`Move ${g.title} up, to card ${i}`" @click="move(i, -1)">
                <Icon name="lucide:arrow-up" aria-hidden="true" />
              </UiButton>
              <UiButton size="icon-sm" variant="ghost" :data-move="`down-${g.id}`" :disabled="i === cardRows.length - 1"
                :aria-label="`Move ${g.title} down, to card ${i + 2}`" @click="move(i, 1)">
                <Icon name="lucide:arrow-down" aria-hidden="true" />
              </UiButton>
              <UiButton size="icon-sm" variant="ghost" :aria-label="`Remove ${g.title} from the homepage`" @click="removeCard(i)">
                <Icon name="lucide:x" aria-hidden="true" />
              </UiButton>
            </li>
          </ol>

          <form class="flex items-end gap-2" @submit.prevent="addCard">
            <div class="min-w-0 flex-1">
              <UiLabel for="add-guide" class="mb-1">Add a guide</UiLabel>
              <SearchSelect id="add-guide" v-model="cardPick" placeholder="Choose a published guide" empty-text="No other published guide matches."
                :disabled="!main || cards.length >= MAX_CARDS" :options="unused.map((g) => ({ value: g.id, label: g.title }))" />
            </div>
            <UiButton type="submit" variant="outline" :disabled="!cardPick || !main || cards.length >= MAX_CARDS">Add</UiButton>
          </form>
          <p v-if="!main" class="text-muted-foreground text-sm">Choose a main guide first: cards only show below one.</p>
          <p v-else-if="cards.length >= MAX_CARDS" class="text-muted-foreground text-sm">That's two, the most the guides section shows. Remove one to add another.</p>
        </section>

        <div class="space-y-2">
          <div class="flex flex-wrap gap-2">
            <UiButton :disabled="!changed || saving || cannotSave" :aria-describedby="cannotSave ? 'cannot-save' : undefined" @click="save">
              {{ saving ? "Saving…" : "Save the homepage" }}
            </UiButton>
            <UiButton v-if="changed" variant="ghost" :disabled="saving" @click="reset">Discard changes</UiButton>
          </div>
          <p v-if="cannotSave" id="cannot-save" class="text-sm">
            Choose a main guide, or remove the cards: cards only show below a main guide.
          </p>
          <p v-else-if="changed" class="text-sm">Not saved yet. The homepage changes when you save.</p>
          <p class="sr-only" role="status">{{ status }}</p>
        </div>
      </div>

      <section aria-labelledby="preview-heading" class="min-w-0">
        <h2 id="preview-heading" class="font-medium">Preview</h2>
        <p class="text-muted-foreground text-sm">The homepage, top to bottom, as visitors will see it after saving.</p>
        <div class="border-border bg-background mt-3 overflow-hidden rounded-lg border">
          <template v-if="previewMain">
            <HomepageHero :guide="previewMain" :link-base="websiteUrl" />
            <div class="mx-auto max-w-6xl px-4 py-8">
              <div class="border-border text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                On lokl now: listings show here
              </div>
            </div>
            <HomepageGuidesSection :cards="previewCards" :market="previewMain.market"
              :market-name="mainGuide?.marketName || 'Atlanta'" :link-base="websiteUrl" />
          </template>
          <p v-else class="text-muted-foreground p-8 text-center text-sm">
            No main guide: the homepage starts with its headline, as it does now, and shows no guides.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
