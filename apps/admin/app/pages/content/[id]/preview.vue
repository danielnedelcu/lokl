<script setup lang="ts">
import type { Guide, GuidePhoto } from "@repo/types";

// The draft as visitors would see it, drawn by the same renderer as the
// public guide page (GuideBody). Visitors never see drafts.
const route = useRoute();
const id = computed(() => String(route.params.id));
const supabase = useSupabaseClient();

const { data, error } = await useAsyncData(`guide-preview-${id.value}`, async () => {
  const { data: guide, error: e } = await supabase.from("guides").select("*, market:cities(name)").eq("id", id.value).maybeSingle();
  if (e) throw e;
  if (!guide) return null;
  const { data: photos, error: pe } = await supabase.from("guide_photos").select("*").eq("guide_id", id.value);
  if (pe) throw pe;
  return { guide: guide as unknown as Guide & { market: { name: string } | null }, photos: photos as GuidePhoto[] };
});
watch(error, (e) => e && reportProblem("Couldn't load the preview", e), { immediate: true });
useHead({ title: computed(() => `Preview: ${data.value?.guide.draft_title || "Untitled guide"}`) });

const photos = computed(() => guidePhotoMap(supabase, data.value?.photos ?? []));
const cover = computed(() => (data.value?.guide.draft_cover_photo_id ? photos.value[data.value.guide.draft_cover_photo_id] : undefined));
</script>

<template>
  <div>
    <div class="bg-muted mb-6 flex flex-wrap items-center justify-between gap-2 rounded-md p-3 text-sm">
      <p class="flex items-center gap-1">
        <Icon name="lucide:eye" aria-hidden="true" />
        Preview of the draft. Visitors don't see it until you publish.
      </p>
      <UiButton size="sm" variant="outline" :to="`/content/${id}`">
        <Icon name="lucide:arrow-left" aria-hidden="true" />Back to the editor
      </UiButton>
    </div>

    <UiAlert v-if="error" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>Couldn't load the preview</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!data" icon="lucide:map" title="We couldn't find that guide" description="It may have been deleted." />

    <article v-else class="mx-auto max-w-3xl space-y-6">
      <header class="space-y-3">
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{{ data.guide.draft_title || "Untitled guide" }}</h1>
        <p class="text-muted-foreground text-lg">{{ data.guide.draft_teaser }}</p>
        <p class="text-sm">By lokl {{ data.guide.market?.name }}</p>
      </header>
      <figure v-if="cover">
        <NuxtImg :src="cover.url" :alt="cover.alt" :width="cover.width" :height="cover.height" class="h-auto w-full rounded-lg" />
        <figcaption v-if="cover.credit" class="text-muted-foreground mt-2 text-sm"><PhotoCredit :credit="cover.credit" /></figcaption>
      </figure>
      <p v-else class="border-border rounded-md border border-dashed p-6 text-center text-sm">No cover photo yet.</p>
      <GuideBody :body="data.guide.draft_body" :photos="photos" />
      <p class="border-border text-muted-foreground rounded-md border border-dashed p-4 text-sm">
        The listings block appears here on the site: live listings matching the guide's area and category.
      </p>
    </article>
  </div>
</template>
