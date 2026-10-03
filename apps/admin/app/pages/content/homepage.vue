<script setup lang="ts">
import type { HomepageGuide, PublicGuidePhoto } from "@repo/types";

// Which guides lead the homepage, and in what order (docs/design/
// destination-guides.md, The homepage): up to five published guides, the
// first as the large hero. Saved in one step (admin_set_homepage_features),
// so the homepage is never half-changed. The preview uses the website's
// own component.
useHead({ title: "Homepage · Admin" });
const supabase = useSupabaseClient();
const websiteUrl = useRuntimeConfig().public.websiteUrl.replace(/\/$/, "");
const MAX = 5;

interface Choice {
  id: string;
  title: string;
  teaser: string;
  market: string;
  slug: string;
  cover: PublicGuidePhoto | null;
}

const { data, error, refresh } = await useAsyncData("admin-homepage", async () => {
  const [guides, features] = await Promise.all([
    supabase
      .from("guides")
      .select("id, slug, title, teaser, market:cities(slug), cover:guide_photos!guides_cover_fk(id, storage_path, card_path, width, height, alt_text, source, credit_name, credit_url, source_url, licence)")
      .eq("status", "published")
      .order("content_updated_at", { ascending: false }),
    supabase.from("homepage_features").select("position, guide_id").order("position"),
  ]);
  for (const r of [guides, features]) if (r.error) throw r.error;
  const published: Choice[] = (guides.data as any[]).map((g) => ({
    id: g.id,
    title: g.title ?? "",
    teaser: g.teaser ?? "",
    slug: g.slug,
    market: g.market?.slug ?? "",
    cover: g.cover
      ? { id: g.cover.id, path: g.cover.storage_path, card_path: g.cover.card_path, width: g.cover.width, height: g.cover.height,
          alt: g.cover.alt_text, source: g.cover.source, credit_name: g.cover.credit_name, credit_url: g.cover.credit_url,
          source_url: g.cover.source_url, licence: g.cover.licence }
      : null,
  }));
  return { published, saved: (features.data ?? []).map((f) => f.guide_id) };
});
watch(error, (e) => e && reportProblem("Couldn't load the homepage guides", e), { immediate: true });

// The list being edited, starting from what's saved.
const chosen = ref<string[]>([]);
watch(data, (d) => (chosen.value = [...(d?.saved ?? [])]), { immediate: true });
const byId = computed(() => new Map((data.value?.published ?? []).map((g) => [g.id, g])));
const rows = computed(() => chosen.value.map((id) => byId.value.get(id)).filter((g): g is Choice => !!g));
const changed = computed(() => JSON.stringify(chosen.value) !== JSON.stringify(data.value?.saved ?? []));

const adding = ref<string | null>("");
const addable = computed(() => (data.value?.published ?? []).filter((g) => !chosen.value.includes(g.id)));
function add() {
  if (!adding.value || chosen.value.length >= MAX) return;
  chosen.value = [...chosen.value, adding.value];
  adding.value = "";
}
function move(i: number, dir: -1 | 1) {
  const next = [...chosen.value];
  [next[i], next[i + dir]] = [next[i + dir]!, next[i]!];
  chosen.value = next;
}
const remove = (i: number) => (chosen.value = chosen.value.filter((_, j) => j !== i));
const placeLabel = (i: number) => (i === 0 ? "Hero" : `Card ${i}`);

const saving = ref(false);
async function save() {
  saving.value = true;
  const { error: e } = await supabase.rpc("admin_set_homepage_features", { p_guide_ids: chosen.value });
  saving.value = false;
  if (e) return void useSonner.error(reportProblem(e.message.startsWith("Only a published") ? e.message : "The homepage wasn't saved. Try again.", e));
  useSonner.success(chosen.value.length ? "Saved. The homepage shows these within a minute." : "Saved. The homepage shows its headline first again.");
  await refresh();
}

const preview = computed<HomepageGuide[]>(() =>
  rows.value.filter((g) => g.cover).map((g, i) => ({ position: i + 1, market: g.market, slug: g.slug, title: g.title, teaser: g.teaser, cover: g.cover! })),
);
</script>

<template>
  <div>
    <PageHeader title="Homepage" description="Up to five published guides at the top of the homepage. The first is the large hero; the rest are the cards below it." />

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load the homepage guides</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="data && !data.published.length" icon="lucide:house" title="No published guides yet"
      description="Publish a guide first, then choose it here to lead the homepage." />

    <div v-else-if="data" class="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section aria-labelledby="chosen-heading" class="space-y-4">
        <h2 id="chosen-heading" class="font-medium">On the homepage ({{ chosen.length }} of {{ MAX }})</h2>
        <p v-if="!rows.length" class="border-border rounded-md border border-dashed p-4 text-sm">
          None chosen. The homepage starts with its headline, as it does now.
        </p>
        <ol v-else class="divide-border divide-y rounded-lg border">
          <li v-for="(g, i) in rows" :key="g.id" class="flex items-center gap-2 p-3">
            <UiBadge :variant="i === 0 ? 'default' : 'outline'" class="shrink-0">{{ placeLabel(i) }}</UiBadge>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ g.title }}</span>
            <UiButton size="icon-sm" variant="ghost" :disabled="i === 0" :aria-label="`Move ${g.title} up`" @click="move(i, -1)">
              <Icon name="lucide:arrow-up" aria-hidden="true" />
            </UiButton>
            <UiButton size="icon-sm" variant="ghost" :disabled="i === rows.length - 1" :aria-label="`Move ${g.title} down`" @click="move(i, 1)">
              <Icon name="lucide:arrow-down" aria-hidden="true" />
            </UiButton>
            <UiButton size="icon-sm" variant="ghost" :aria-label="`Remove ${g.title} from the homepage`" @click="remove(i)">
              <Icon name="lucide:x" aria-hidden="true" />
            </UiButton>
          </li>
        </ol>

        <form class="flex items-end gap-2" @submit.prevent="add">
          <div class="min-w-0 flex-1">
            <UiLabel for="add-guide" class="mb-1">Add a guide</UiLabel>
            <SearchSelect id="add-guide" v-model="adding" placeholder="Choose a published guide" empty-text="No other published guide matches."
              :disabled="chosen.length >= MAX" :options="addable.map((g) => ({ value: g.id, label: g.title }))" />
          </div>
          <UiButton type="submit" variant="outline" :disabled="!adding || chosen.length >= MAX">Add</UiButton>
        </form>
        <p v-if="chosen.length >= MAX" class="text-muted-foreground text-sm">That's five, the most the homepage shows. Remove one to add another.</p>

        <div class="flex flex-wrap gap-2 pt-2">
          <UiButton :disabled="!changed || saving" @click="save">{{ saving ? "Saving…" : "Save the homepage" }}</UiButton>
          <UiButton v-if="changed" variant="ghost" :disabled="saving" @click="chosen = [...(data.saved ?? [])]">Discard changes</UiButton>
        </div>
        <p v-if="changed" class="text-sm" role="status">Not saved yet. The homepage changes when you save.</p>
      </section>

      <section aria-labelledby="preview-heading" class="min-w-0">
        <h2 id="preview-heading" class="font-medium">Preview</h2>
        <p class="text-muted-foreground text-sm">The top of the homepage, as visitors will see it after saving.</p>
        <div class="border-border bg-background mt-3 overflow-hidden rounded-lg border pb-8">
          <HomepageGuides v-if="preview.length" :guides="preview" :link-base="websiteUrl" />
          <p v-else class="text-muted-foreground p-8 text-center text-sm">No guides chosen: the homepage starts with its headline.</p>
        </div>
      </section>
    </div>
  </div>
</template>
