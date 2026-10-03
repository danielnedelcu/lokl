<script setup lang="ts">
import type { GuideBodyPhoto, GuideVersion } from "@repo/types";

// What was live before: one version each time the guide was published
// (guide_versions). Read-only, with "Copy into draft" to start from one.
const props = defineProps<{ guideId: string; photos: Record<string, GuideBodyPhoto> }>();
const emit = defineEmits<{ copy: [version: GuideVersion] }>();
const open = defineModel<boolean>("open", { required: true });

const supabase = useSupabaseClient();
// shallowRef: the body is JSON, which Vue's deep ref type can't unwrap.
const versions = shallowRef<GuideVersion[]>([]);
const loading = ref(false);
const error = ref("");
const viewing = shallowRef<GuideVersion | null>(null);
const confirmOpen = ref(false);

async function load() {
  loading.value = true;
  const { data, error: e } = await supabase
    .from("guide_versions")
    .select("*")
    .eq("guide_id", props.guideId)
    .order("published_at", { ascending: false });
  loading.value = false;
  error.value = e ? reportProblem("The versions didn't load.", e) : "";
  versions.value = data ?? [];
}
watch(open, (o) => {
  if (o) {
    viewing.value = null;
    void load();
  }
});

function copy() {
  if (viewing.value) emit("copy", viewing.value);
  confirmOpen.value = false;
  open.value = false;
}
</script>

<template>
  <UiSheet v-model:open="open">
    <UiSheetContent side="right" class="w-full overflow-y-auto sm:max-w-2xl" title="Versions"
      description="What was live each time this guide was published.">
      <template #content>
        <div class="space-y-4 px-4 pb-6">
          <p v-if="loading" class="text-muted-foreground text-sm">Loading versions…</p>
          <UiAlert v-else-if="error" variant="destructive" icon="lucide:alert-circle">
            <UiAlertTitle>{{ error }}</UiAlertTitle>
            <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
          </UiAlert>
          <p v-else-if="!versions.length" class="text-muted-foreground text-sm">
            No versions yet. One is kept each time you publish.
          </p>

          <template v-else-if="!viewing">
            <ul class="divide-border divide-y rounded-md border">
              <li v-for="(v, i) in versions" :key="v.id">
                <button type="button" class="hover:bg-accent flex min-h-11 w-full items-center justify-between gap-2 p-3 text-left"
                  @click="viewing = v">
                  <span>
                    <span class="block font-medium">{{ v.title }}</span>
                    <span class="text-muted-foreground block text-sm">
                      Published {{ formatDateTime(v.published_at) }}<template v-if="i === 0"> · the latest</template>
                    </span>
                  </span>
                  <Icon name="lucide:chevron-right" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </template>

          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <UiButton variant="ghost" size="sm" @click="viewing = null">
                <Icon name="lucide:arrow-left" aria-hidden="true" />All versions
              </UiButton>
              <UiButton size="sm" variant="outline" @click="confirmOpen = true">Copy into draft</UiButton>
            </div>
            <p class="text-muted-foreground text-sm">Published {{ formatDateTime(viewing.published_at) }}</p>
            <article class="space-y-4">
              <h3 class="text-2xl font-semibold tracking-tight">{{ viewing.title }}</h3>
              <p class="text-muted-foreground">{{ viewing.teaser }}</p>
              <NuxtImg v-if="viewing.cover_photo_id && photos[viewing.cover_photo_id]" :src="photos[viewing.cover_photo_id]!.url"
                :alt="photos[viewing.cover_photo_id]!.alt" :width="photos[viewing.cover_photo_id]!.width"
                :height="photos[viewing.cover_photo_id]!.height" class="h-auto w-full rounded-md" />
              <GuideBody :body="viewing.body" :photos="photos" />
            </article>
          </template>
        </div>
      </template>
    </UiSheetContent>
  </UiSheet>

  <UiAlertDialog v-model:open="confirmOpen" title="Copy this version into the draft?"
    description="This replaces your current draft. Your published guide isn't affected.">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep my draft" />
        <UiAlertDialogAction text="Replace the draft" @click="copy" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
