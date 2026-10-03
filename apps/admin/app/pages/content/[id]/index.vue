<script setup lang="ts">
import {
  bodyPhotoIds,
  findStalePhrases,
  phraseContext,
  guidePublishBlockers,
  guideSlugSchema,
  guideState,
  GUIDE_PHOTO_BUCKET,
  GUIDE_TEASER_MAX,
  GUIDE_TITLE_MAX,
  type Category,
  type Guide,
  type GuidePhoto,
  type GuideVersion,
  type ListingKind,
  type ServiceArea,
} from "@repo/types";
import type { BodyPhrase } from "~/utils/guidePhrases";

// The guide editor (docs/design/destination-guides.md, The editor). It edits
// the draft only; "Publish" copies the draft over the live copy through the
// admin app's server route, and the database checks it first.
const route = useRoute();
const id = computed(() => String(route.params.id));
const supabase = useSupabaseClient();

const { data, error } = await useAsyncData(`guide-editor-${id.value}`, async () => {
  const { data: guide, error: e } = await supabase.from("guides").select("*").eq("id", id.value).maybeSingle();
  if (e) throw e;
  if (!guide) return null;
  const [photos, areas, categories, market] = await Promise.all([
    supabase.from("guide_photos").select("*").eq("guide_id", id.value).order("created_at"),
    supabase.from("service_areas").select("*").eq("city_id", guide.market_id).order("sort_order").order("name"),
    supabase.from("categories").select("*").order("kind").order("sort_order").order("name"),
    supabase.from("cities").select("name, slug").eq("id", guide.market_id).single(),
  ]);
  for (const r of [photos, areas, categories, market]) if (r.error) throw r.error;
  return {
    guide: guide as Guide,
    photos: photos.data as GuidePhoto[],
    areas: areas.data as ServiceArea[],
    categories: categories.data as Category[],
    market: market.data!,
  };
});
watch(error, (e) => e && reportProblem("Couldn't load the guide", e), { immediate: true });

useHead({ title: computed(() => `${data.value?.guide.draft_title || "Untitled guide"} · Guides`) });

// shallowRef: the body is JSON, which Vue's deep ref type can't unwrap. Replaced whole on reload.
const guide = shallowRef<Guide | null>(data.value?.guide ?? null);
const photos = shallowRef<GuidePhoto[]>(data.value?.photos ?? []);
const areas = computed(() => data.value?.areas ?? []);
const categories = computed(() => data.value?.categories ?? []);

// The draft as the editor holds it (what's saved, plus what's waiting to save).
const g0 = guide.value;
const draft = reactive({
  title: g0?.draft_title ?? "",
  teaser: g0?.draft_teaser ?? "",
  slug: g0?.slug ?? "",
  areaId: g0?.draft_area_id ?? null,
  categoryId: g0?.draft_category_id ?? null,
  kind: (g0?.draft_listing_kind ?? null) as ListingKind | null,
  coverId: g0?.draft_cover_photo_id ?? null,
  body: (g0?.draft_body ?? { blocks: [] }) as unknown,
});

const autosave = useGuideAutosave(id.value, g0?.updated_at ?? "");

/** Re-read the guide row after a change made outside autosave (publishing, deleting a photo). */
async function reloadGuide() {
  const { data: row, error: e } = await supabase.from("guides").select("*").eq("id", id.value).single();
  if (e) return void reportProblem("Couldn't reload the guide", e);
  guide.value = row as Guide;
  autosave.rebase(row.updated_at);
  draft.coverId = row.draft_cover_photo_id;
}
async function reloadPhotos() {
  const { data: rows, error: e } = await supabase.from("guide_photos").select("*").eq("guide_id", id.value).order("created_at");
  if (e) return void useSonner.error(reportProblem("The photos didn't reload. Refresh the page.", e));
  photos.value = rows as GuidePhoto[];
}

// ---------------------------------------------------------------------------
// Where the guide stands
// ---------------------------------------------------------------------------

const current = computed(() =>
  guide.value
    ? {
        ...guide.value,
        draft_title: draft.title,
        draft_teaser: draft.teaser,
        draft_body: draft.body as Guide["draft_body"],
        draft_area_id: draft.areaId,
        draft_category_id: draft.categoryId,
        draft_listing_kind: draft.kind,
        draft_cover_photo_id: draft.coverId,
      }
    : null,
);
const state = computed(() => (current.value ? guideState(current.value) : "draft"));
const cover = computed(() => photos.value.find((p) => p.id === draft.coverId) ?? null);
const blockers = computed(() => (current.value ? guidePublishBlockers(current.value, cover.value) : []));
const everPublished = computed(() => !!guide.value?.published_at);
const photoMap = computed(() => guidePhotoMap(supabase, photos.value));
const photoOptions = computed(() => photos.value.map((p) => ({ id: p.id, url: photoMap.value[p.id]!.cardUrl, alt: p.alt_text })));
// Used by the published version: its body's photos while it's on the site,
// and its cover (which the database keeps until a new cover is published).
const liveIds = computed(() => {
  const ids = guide.value?.status === "published" ? bodyPhotoIds(guide.value.body) : new Set<string>();
  if (guide.value?.cover_photo_id) ids.add(guide.value.cover_photo_id);
  return ids;
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const bodyNote = ref("");
function onBody(body: unknown) {
  // A new body being loaded: the editor's changes are redraws, not edits.
  if (autosave.bodyHeld.value) return;
  bodyNote.value = "";
  draft.body = body;
  autosave.change({ draft_body: body as Guide["draft_body"] });
}

// The web address: checked as it's typed, saved only once it's valid and free.
const slugError = ref("");
const slugChecking = ref(false);
let slugTimer: ReturnType<typeof setTimeout> | undefined;
function onSlug() {
  clearTimeout(slugTimer);
  autosave.discard("slug");
  const parsed = guideSlugSchema.safeParse(draft.slug);
  if (!parsed.success) {
    slugError.value = parsed.error.issues[0]!.message;
    return;
  }
  slugError.value = "";
  slugChecking.value = true;
  slugTimer = setTimeout(async () => {
    const slug = parsed.data;
    const { data: taken, error: e } = await supabase
      .from("guides")
      .select("id")
      .eq("market_id", guide.value!.market_id)
      .eq("slug", slug)
      .neq("id", id.value)
      .limit(1);
    slugChecking.value = false;
    if (slug !== draft.slug) return;
    if (e) slugError.value = reportProblem("Couldn't check this address. It will be checked again when it saves.", e);
    else if (taken.length) return void (slugError.value = "Another guide already uses this address. Choose a different one.");
    autosave.change({ slug }, true);
  }, 400);
}
watch(() => autosave.message.value, (m) => {
  if (m.startsWith("That web address")) slugError.value = m;
});

function onCategory() {
  // A category belongs to one kind, so the separate kind choice is cleared.
  if (draft.categoryId) draft.kind = null;
  autosave.change({ draft_category_id: draft.categoryId, draft_listing_kind: draft.kind }, true);
}

function setCover(photoId: string) {
  draft.coverId = photoId;
  autosave.change({ draft_cover_photo_id: photoId }, true);
}

// ---------------------------------------------------------------------------
// Photos: deleting takes the photo out of the draft too
// ---------------------------------------------------------------------------

const bodyEditor = ref<{
  replace: (b: unknown) => Promise<boolean>;
  removePhoto: (id: string) => Promise<boolean>;
  reveal: (key: string) => void;
  setReadOnly: (on: boolean) => Promise<void>;
} | null>(null);

async function removePhoto(photo: GuidePhoto) {
  if (!(await autosave.flush())) {
    return void useSonner.error("Your latest changes haven't saved yet. Try again once they have.");
  }
  const { error: e } = await supabase.from("guide_photos").delete().eq("id", photo.id);
  if (e) return void useSonner.error(reportProblem("The photo wasn't deleted. Try again.", e));
  await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove([photo.storage_path, ...(photo.card_path ? [photo.card_path] : [])]);
  // Deleting the draft cover clears it in the database, which changes the row.
  await reloadGuide();
  await reloadPhotos();
  await bodyEditor.value?.removePhoto(photo.id);
  useSonner.success("Photo deleted.");
}

// ---------------------------------------------------------------------------
// AI drafts and review
// ---------------------------------------------------------------------------

const pendingReview = computed(() => !!guide.value?.ai_draft_pending_review);
// While an AI draft is being written, nothing on the page can be edited.
const locked = ref(false);
// The body is held (never autosaved) from the moment an AI draft is asked
// for until the editor shows exactly what landed (takeGuide), so a redraw
// can't save an empty or old body over it.
let landing = false;
async function onAiRunning(running: boolean) {
  locked.value = running;
  if (running) autosave.holdBody();
  else if (!landing && !bodyNotShown.value) autosave.releaseBody();
  await bodyEditor.value?.setReadOnly(running);
}
/** Save what's waiting; the guide's updated_at for the server to check, or null. */
async function prepare() {
  return (await autosave.flush()) ? autosave.current() : null;
}
/** Show a guide row that changed on the server (an AI draft landed, or the draft before it came back). */
const bodyNotShown = ref(false);
async function takeGuide(row: Guide) {
  landing = true;
  autosave.holdBody();
  guide.value = row;
  autosave.rebase(row.updated_at);
  Object.assign(draft, {
    title: row.draft_title,
    teaser: row.draft_teaser,
    areaId: row.draft_area_id,
    categoryId: row.draft_category_id,
    kind: row.draft_listing_kind as ListingKind | null,
    coverId: row.draft_cover_photo_id,
    body: row.draft_body,
  });
  bodyNote.value = "";
  try {
    const shown = await bodyEditor.value?.replace(row.draft_body);
    bodyNotShown.value = shown === false;
    // Only once the editor shows exactly what's saved can edits be saved again.
    if (!bodyNotShown.value) autosave.releaseBody();
  } finally {
    landing = false;
  }
}
function useSuggestedSlug(slug: string) {
  draft.slug = slug;
  onSlug();
}

// Phrases to check: the body's come from the editor; the title's and teaser's from here.
const bodyPhrases = ref<BodyPhrase[]>([]);
const fieldPhrases = computed<BodyPhrase[]>(() =>
  pendingReview.value
    ? (["title", "teaser"] as const).flatMap((field) => {
        const text = field === "title" ? draft.title : draft.teaser;
        return findStalePhrases(text).map((p, i) => ({ ...p, key: `${field}:${i}`, blockId: field, context: phraseContext(text, p) }));
      })
    : [],
);
const phrases = computed(() => [...fieldPhrases.value, ...bodyPhrases.value]);
function reveal(p: BodyPhrase) {
  if (p.blockId === "title" || p.blockId === "teaser") {
    const el = document.getElementById(p.blockId === "title" ? "guide-title" : "guide-teaser") as HTMLInputElement | null;
    el?.focus();
    el?.setSelectionRange(p.start, p.end);
    return;
  }
  bodyEditor.value?.reveal(p.key);
}

const review = ref<{ close: () => void } | null>(null);
async function markReviewed() {
  busy.value = true;
  try {
    if (!(await autosave.flush())) return void useSonner.error("Your latest changes haven't saved yet. Wait for “Saved”, then try again.");
    // The database records who and when (guides_guard).
    const { data: rows, error: e } = await supabase
      .from("guides")
      .update({ ai_draft_pending_review: false })
      .eq("id", id.value)
      .eq("updated_at", autosave.current())
      .select("*");
    if (e) return void useSonner.error(reportProblem("It wasn't marked as reviewed. Try again.", e));
    if (!rows.length) return void useSonner.error("This guide changed somewhere else. Reload, then try again.");
    guide.value = rows[0] as Guide;
    autosave.rebase(rows[0]!.updated_at);
    review.value?.close();
    useSonner.success("Marked as reviewed. It can be published now.");
  } finally {
    busy.value = false;
  }
}

// ---------------------------------------------------------------------------
// Publishing, unpublishing, versions, deleting
// ---------------------------------------------------------------------------

const busy = ref(false);
const unpublishOpen = ref(false);
const versionsOpen = ref(false);
const deleteOpen = ref(false);

const publishLabel = computed(() =>
  state.value === "changes" ? "Publish changes" : state.value === "unpublished" ? "Publish again" : "Publish",
);
const nothingToPublish = computed(() => state.value === "published");

// The first publish fixes the guide's web address for good, so it's
// confirmed: and if the address doesn't match the one the current title
// suggests (such as a leftover from an earlier title), the confirmation says
// so and offers to switch to it in one click.
const firstPublishOpen = ref(false);
const suggestedSlug = computed(() => slugify(draft.title).slice(0, 80).replace(/-+$/, ""));
const slugDiffers = computed(() => guideSlugSchema.safeParse(suggestedSlug.value).success && suggestedSlug.value !== draft.slug);
const suggestedTaken = ref(false);
const marketPath = computed(() => `/${data.value?.market.slug ?? ""}/guides/`);

async function askPublish() {
  if (everPublished.value) return void act("publish");
  suggestedTaken.value = false;
  if (slugDiffers.value) {
    const { data: taken, error: e } = await supabase.from("guides").select("id")
      .eq("market_id", guide.value!.market_id).eq("slug", suggestedSlug.value).neq("id", id.value).limit(1);
    suggestedTaken.value = !!e || !!taken?.length;
  }
  firstPublishOpen.value = true;
}
async function publishWithSuggested() {
  draft.slug = suggestedSlug.value;
  slugError.value = "";
  autosave.change({ slug: suggestedSlug.value }, true);
  await act("publish");
}

async function act(action: "publish" | "unpublish") {
  busy.value = true;
  try {
    if (!(await autosave.flush())) {
      return void useSonner.error("Your latest changes haven't saved yet. Wait for “Saved”, then try again.");
    }
    await $fetch(`/api/guides/${id.value}/${action}`, { method: "POST" });
    useSonner.success(action === "publish" ? "Published. It's live on the site." : "Unpublished. It's off the site and the homepage.");
    unpublishOpen.value = false;
    firstPublishOpen.value = false;
  } catch (e) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    useSonner.error(reportProblem(err.data?.statusMessage ?? "That didn't work. Try again, or check the server logs.", e));
  } finally {
    await reloadGuide();
    busy.value = false;
  }
}

async function copyVersion(v: GuideVersion) {
  const coverStillThere = !!v.cover_photo_id && photos.value.some((p) => p.id === v.cover_photo_id);
  Object.assign(draft, {
    title: v.title,
    teaser: v.teaser,
    body: v.body,
    areaId: v.area_id,
    categoryId: v.category_id,
    kind: v.listing_kind as ListingKind | null,
    coverId: coverStillThere ? v.cover_photo_id : null,
  });
  autosave.change(
    {
      draft_title: v.title,
      draft_teaser: v.teaser,
      draft_body: v.body,
      draft_area_id: v.area_id,
      draft_category_id: v.category_id,
      draft_listing_kind: v.listing_kind,
      draft_cover_photo_id: draft.coverId,
    },
    true,
  );
  await bodyEditor.value?.replace(v.body);
  useSonner.success(coverStillThere || !v.cover_photo_id ? "Copied into the draft." : "Copied into the draft. Its cover photo was deleted, so choose a new one.");
}

async function deleteGuide() {
  busy.value = true;
  const files = photos.value.flatMap((p) => [p.storage_path, ...(p.card_path ? [p.card_path] : [])]);
  const { error: e } = await supabase.from("guides").delete().eq("id", id.value);
  if (e) {
    busy.value = false;
    return void useSonner.error(reportProblem("The guide wasn't deleted. Try again.", e));
  }
  if (files.length) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove(files);
  autosave.stop();
  useSonner.success("Guide deleted.");
  await navigateTo("/content");
}

async function preview() {
  if (!(await autosave.flush())) {
    return void useSonner.error("Your latest changes haven't saved yet. Wait for “Saved”, then try again.");
  }
  await navigateTo(`/content/${id.value}/preview`);
}

const saveLabel = computed(() => {
  switch (autosave.state.value) {
    case "saved":
      return { icon: "lucide:check", text: "Saved" };
    case "waiting":
    case "saving":
      return { icon: "lucide:loader-circle", text: "Saving…" };
    case "retrying":
      return { icon: "lucide:refresh-cw", text: "Couldn't save, retrying" };
    case "failing":
      return { icon: "lucide:alert-triangle", text: "Not saved. Copy your text before leaving." };
    case "refused":
      return { icon: "lucide:alert-triangle", text: "Not saved" };
    case "conflict":
      return { icon: "lucide:alert-triangle", text: "Not saved" };
  }
});
</script>

<template>
  <div>
    <UiAlert v-if="error" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>Couldn't load this guide</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!guide" icon="lucide:map" title="We couldn't find that guide"
      description="It may have been deleted. Go back to the guides list.">
    </EmptyState>

    <template v-else>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <NuxtLink to="/content" class="text-muted-foreground flex min-h-9 items-center gap-1 text-sm hover:underline">
          <Icon name="lucide:arrow-left" aria-hidden="true" />All guides
        </NuxtLink>
        <p class="flex items-center gap-1 text-sm" role="status" aria-live="polite">
          <Icon :name="saveLabel.icon" :class="saveLabel.text === 'Saving…' && 'animate-spin'" aria-hidden="true" />
          {{ saveLabel.text }}
          <UiButton v-if="autosave.state.value === 'failing' || autosave.state.value === 'refused'" size="sm" variant="link"
            @click="autosave.flush()">Try now</UiButton>
        </p>
      </div>

      <UiAlert v-if="bodyNotShown" variant="destructive" icon="lucide:alert-triangle" class="mb-4">
        <UiAlertTitle>The new text is saved, but the editor couldn't show it.</UiAlertTitle>
        <UiAlertDescription>
          Reload the page before editing the text. Until then, changes to the text aren't saved, so nothing overwrites it.
          <UiButton size="sm" variant="outline" class="mt-2" @click="reloadNuxtApp()">Reload</UiButton>
        </UiAlertDescription>
      </UiAlert>
      <UiAlert v-else-if="autosave.state.value === 'conflict'" variant="destructive" icon="lucide:alert-triangle" class="mb-4">
        <UiAlertTitle>{{ autosave.message.value }}</UiAlertTitle>
        <UiAlertDescription>
          Copy anything you want to keep from this page first: reloading shows the saved version.
          <UiButton size="sm" variant="outline" class="mt-2" @click="() => { autosave.stop(); reloadNuxtApp(); }">Reload</UiButton>
        </UiAlertDescription>
      </UiAlert>
      <UiAlert v-else-if="autosave.state.value === 'refused' && !autosave.message.value.startsWith('That web address')"
        variant="destructive" icon="lucide:alert-triangle" class="mb-4">
        <UiAlertTitle>{{ autosave.message.value }}</UiAlertTitle>
      </UiAlert>

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <!-- Writing column -->
        <fieldset :disabled="locked" class="min-w-0 space-y-6">
          <legend class="sr-only">The guide's draft</legend>
          <GuideReview v-if="pendingReview" ref="review" :phrases="phrases" :busy="busy || locked" @reveal="reveal"
            @confirm="markReviewed" />
          <div>
            <UiLabel for="guide-title" class="mb-2">Title</UiLabel>
            <UiInput id="guide-title" v-model="draft.title" :maxlength="GUIDE_TITLE_MAX" autocomplete="off"
              class="h-auto py-2 text-2xl font-semibold tracking-tight md:text-2xl"
              placeholder="Murals of the Eastside Trail" @input="autosave.change({ draft_title: draft.title })" />
          </div>
          <div>
            <p id="body-label" class="mb-2 text-sm font-medium">Guide text</p>
            <div class="border-input rounded-md border px-4 py-3 sm:px-12">
              <GuideBodyEditor ref="bodyEditor" :body="draft.body" :photos="photoOptions" labelledby="body-label"
                :highlight="pendingReview" @change="onBody" @invalid="(m) => (bodyNote = m)" @phrases="(p) => (bodyPhrases = p)" />
            </div>
            <p v-if="bodyNote" class="text-destructive mt-2 flex items-center gap-1 text-sm" role="alert">
              <Icon name="lucide:alert-circle" aria-hidden="true" />{{ bodyNote }}
            </p>
            <p class="text-muted-foreground mt-2 text-sm">
              Press Tab in an empty line for headings, lists, quotes and photos. Select text for bold, italic and links.
            </p>
          </div>
        </fieldset>

        <!-- Side panel -->
        <aside class="space-y-6" aria-label="Guide settings">
          <GuideAiDraft :guide="guide" :draft-title="draft.title" :draft-area-id="draft.areaId" :draft-category-id="draft.categoryId"
            :has-text="!!(draft.title.trim() || draft.teaser.trim() || ((draft.body as { blocks?: unknown[] })?.blocks?.length ?? 0))"
            :areas="areas" :categories="categories" :prepare="prepare" @running="onAiRunning"
            @landed="(r) => takeGuide(r.guide)" @restored="takeGuide" @use-slug="useSuggestedSlug" />
          <fieldset :disabled="locked" class="space-y-6">
          <legend class="sr-only">Guide settings</legend>
          <section aria-labelledby="status-heading" class="border-border space-y-3 rounded-lg border p-4">
            <div class="flex items-center justify-between gap-2">
              <h2 id="status-heading" class="font-medium">Status</h2>
              <StatusBadge kind="guide" :status="state" />
            </div>
            <p v-if="guide.content_updated_at" class="text-muted-foreground text-sm">
              Live version last updated {{ formatDate(guide.content_updated_at) }}.
            </p>
            <div class="flex flex-wrap gap-2">
              <UiButton :disabled="busy || !!blockers.length || nothingToPublish"
                :aria-describedby="blockers.length ? 'publish-blockers' : undefined" @click="askPublish">
                {{ busy ? "Working…" : publishLabel }}
              </UiButton>
              <UiButton variant="outline" :disabled="busy" @click="preview">Preview</UiButton>
            </div>
            <div v-if="blockers.length" id="publish-blockers" class="text-sm">
              <p class="font-medium">Before you can publish:</p>
              <ul class="mt-1 space-y-1">
                <li v-for="b in blockers" :key="b" class="flex items-start gap-1">
                  <Icon name="lucide:circle-x" class="text-destructive mt-0.5 shrink-0" aria-hidden="true" />{{ b }}
                </li>
              </ul>
            </div>
            <p v-else-if="nothingToPublish" class="text-muted-foreground text-sm">The live guide matches the draft.</p>
            <div class="border-border flex flex-wrap gap-2 border-t pt-3">
              <UiButton v-if="everPublished" size="sm" variant="ghost" @click="versionsOpen = true">
                <Icon name="lucide:history" aria-hidden="true" />Versions
              </UiButton>
              <UiButton v-if="guide.status === 'published'" size="sm" variant="ghost" class="text-destructive" :disabled="busy"
                @click="unpublishOpen = true">Unpublish</UiButton>
              <UiButton v-if="!everPublished" size="sm" variant="ghost" class="text-destructive" :disabled="busy"
                @click="deleteOpen = true">Delete guide</UiButton>
            </div>
          </section>

          <section aria-labelledby="page-heading" class="space-y-4">
            <h2 id="page-heading" class="font-medium">On the site</h2>
            <div>
              <UiLabel for="guide-slug" class="mb-2">Web address</UiLabel>
              <div class="flex items-center gap-1 text-sm">
                <span class="text-muted-foreground shrink-0">/{{ data?.market.slug }}/guides/</span>
                <UiInput id="guide-slug" v-model="draft.slug" :readonly="everPublished" :aria-invalid="!!slugError || undefined"
                  aria-describedby="slug-note" autocomplete="off" @input="onSlug" />
              </div>
              <p id="slug-note" class="mt-1.5 text-sm" :class="slugError ? 'text-destructive' : 'text-muted-foreground'">
                <template v-if="everPublished">Can't change once published (it's in search results).</template>
                <template v-else-if="slugError">{{ slugError }}</template>
                <template v-else-if="slugChecking">Checking…</template>
                <template v-else>Lowercase letters, numbers and hyphens.</template>
              </p>
            </div>
            <div>
              <UiLabel for="guide-teaser" class="mb-2">Teaser</UiLabel>
              <UiTextarea id="guide-teaser" v-model="draft.teaser" :rows="3" :maxlength="GUIDE_TEASER_MAX"
                aria-describedby="teaser-note" @input="autosave.change({ draft_teaser: draft.teaser })" />
              <p id="teaser-note" class="text-muted-foreground mt-1.5 flex justify-between gap-2 text-sm">
                <span>Shown under the photo and in search results.</span>
                <span>{{ draft.teaser.length }} / {{ GUIDE_TEASER_MAX }}</span>
              </p>
            </div>
          </section>

          <section aria-labelledby="listings-heading" class="space-y-4">
            <div>
              <h2 id="listings-heading" class="font-medium">Listings block</h2>
              <p class="text-muted-foreground text-sm">Live listings in this area and/or category, shown with the guide.</p>
            </div>
            <div>
              <UiLabel for="guide-area" class="mb-2">Area</UiLabel>
              <SelectInput id="guide-area" v-model="draft.areaId" :options="guideAreaOptions(areas)"
                @update:model-value="autosave.change({ draft_area_id: draft.areaId }, true)" />
            </div>
            <div>
              <UiLabel for="guide-category" class="mb-2">Category</UiLabel>
              <SelectInput id="guide-category" v-model="draft.categoryId" :options="guideCategoryOptions(categories)"
                @update:model-value="onCategory" />
            </div>
            <div v-if="!draft.categoryId">
              <UiLabel for="guide-kind" class="mb-2">Type</UiLabel>
              <SelectInput id="guide-kind" :model-value="draft.kind" :options="[
                { value: null, label: 'Services and Experiences' },
                { value: 'service', label: 'Services only' },
                { value: 'experience', label: 'Experiences only' },
              ]" @update:model-value="(v) => { draft.kind = (v ?? null) as ListingKind | null; autosave.change({ draft_listing_kind: draft.kind }, true); }" />
            </div>
            <GuideListingsPreview :market-id="guide.market_id" :area-id="draft.areaId" :category-id="draft.categoryId"
              :kind="draft.kind" />
          </section>

          <GuidePhotos :guide-id="guide.id" :photos="photos" :cover-id="draft.coverId" :live-ids="liveIds"
            :remove="removePhoto" @changed="reloadPhotos" @cover="setCover" />
          </fieldset>
        </aside>
      </div>

      <GuideVersions v-model:open="versionsOpen" :guide-id="guide.id" :photos="photoMap" @copy="copyVersion" />

      <UiAlertDialog v-model:open="firstPublishOpen">
        <template #header>
          <UiAlertDialogHeader>
            <UiAlertDialogTitle title="Publish this guide?" />
            <UiAlertDialogDescription description="It goes live on the site. Its web address can't change after this, because it's in search results." />
          </UiAlertDialogHeader>
          <div class="space-y-3 text-sm">
            <p>
              Web address: <code class="bg-muted rounded px-1 break-all">{{ marketPath }}{{ draft.slug }}</code>
            </p>
            <div v-if="slugDiffers" class="border-border rounded-md border p-3">
              <p class="font-medium">This address doesn't match the title.</p>
              <p v-if="!suggestedTaken" class="text-muted-foreground mt-1">
                The title suggests <code class="bg-muted rounded px-1 break-all">{{ marketPath }}{{ suggestedSlug }}</code>.
              </p>
              <p v-else class="text-muted-foreground mt-1">
                The address that matches the title, <code class="bg-muted rounded px-1 break-all">{{ suggestedSlug }}</code>, is used by another guide.
              </p>
            </div>
          </div>
        </template>
        <template #footer>
          <!-- Three long buttons: let them wrap rather than run off the dialog. -->
          <UiAlertDialogFooter class="flex-wrap gap-2">
            <UiAlertDialogCancel text="Not yet" />
            <UiButton v-if="slugDiffers && !suggestedTaken" variant="outline" :disabled="busy" @click="act('publish')">Keep this address and publish</UiButton>
            <UiButton v-if="slugDiffers && !suggestedTaken" :disabled="busy" @click="publishWithSuggested">Use the suggested address and publish</UiButton>
            <UiButton v-else :disabled="busy" @click="act('publish')">Publish</UiButton>
          </UiAlertDialogFooter>
        </template>
      </UiAlertDialog>

      <UiAlertDialog v-model:open="unpublishOpen" title="Unpublish this guide?"
        description="This takes the guide off the site and the homepage. Its address stops working until you publish again.">
        <template #footer>
          <UiAlertDialogFooter>
            <UiAlertDialogCancel text="Keep it live" />
            <UiAlertDialogAction text="Unpublish" variant="destructive" :disabled="busy" @click.prevent="act('unpublish')" />
          </UiAlertDialogFooter>
        </template>
      </UiAlertDialog>

      <UiAlertDialog v-model:open="deleteOpen" title="Delete this guide?"
        description="Its text and photos are deleted. This can't be undone.">
        <template #footer>
          <UiAlertDialogFooter>
            <UiAlertDialogCancel text="Keep it" />
            <UiAlertDialogAction text="Delete guide" variant="destructive" :disabled="busy" @click.prevent="deleteGuide()" />
          </UiAlertDialogFooter>
        </template>
      </UiAlertDialog>
    </template>
  </div>
</template>
