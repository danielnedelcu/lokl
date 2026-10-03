<script setup lang="ts">
import type { GuideBodyPhoto } from "@repo/types";

// A guide's body, drawn from its Editor.js blocks by lokl's own renderer
// (docs/design/destination-guides.md): never inserted as HTML. Used by the
// admin preview and the public guide page, so both look the same. Unknown
// blocks, and photos that no longer exist, are skipped.

const props = defineProps<{
  body: unknown;
  /** The guide's photos by id: photo blocks show only these. */
  photos: Record<string, GuideBodyPhoto>;
}>();

type Block = { id?: string; type?: string; data?: Record<string, any> };
const blocks = computed(() => {
  const list = (props.body as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(list) ? (list as Block[]).filter((b) => b && typeof b === "object" && b.data) : [];
});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const items = (b: Block) => (Array.isArray(b.data?.items) ? (b.data!.items as unknown[]) : []);
// Lists from Editor.js's list tool: items are { content } (older data: strings).
const itemText = (i: unknown) => (typeof i === "string" ? i : str((i as { content?: unknown })?.content));
</script>

<template>
  <div class="space-y-5 text-base leading-7">
    <template v-for="(b, i) in blocks" :key="b.id ?? i">
      <p v-if="b.type === 'paragraph'"><GuideInline :html="str(b.data!.text)" /></p>

      <!-- Levels 2 and 3 only; the title is the page's h1. -->
      <h3 v-else-if="b.type === 'header' && b.data!.level === 3" class="pt-2 text-lg font-semibold">
        <GuideInline :html="str(b.data!.text)" />
      </h3>
      <h2 v-else-if="b.type === 'header'" class="pt-4 text-xl font-semibold tracking-tight">
        <GuideInline :html="str(b.data!.text)" />
      </h2>

      <ol v-else-if="b.type === 'list' && b.data!.style === 'ordered'" class="list-decimal space-y-1 pl-6">
        <li v-for="(item, j) in items(b)" :key="j"><GuideInline :html="itemText(item)" /></li>
      </ol>
      <ul v-else-if="b.type === 'list'" class="list-disc space-y-1 pl-6">
        <li v-for="(item, j) in items(b)" :key="j"><GuideInline :html="itemText(item)" /></li>
      </ul>

      <figure v-else-if="b.type === 'quote'" class="border-border border-l-4 pl-4">
        <blockquote class="text-lg italic"><GuideInline :html="str(b.data!.text)" /></blockquote>
        <figcaption v-if="str(b.data!.caption)" class="text-muted-foreground mt-1 text-sm">
          <GuideInline :html="str(b.data!.caption)" />
        </figcaption>
      </figure>

      <figure v-else-if="b.type === 'photo' && photos[str(b.data!.photoId)]">
        <NuxtImg
          :src="photos[str(b.data!.photoId)]!.url"
          :alt="photos[str(b.data!.photoId)]!.alt"
          :width="photos[str(b.data!.photoId)]!.width"
          :height="photos[str(b.data!.photoId)]!.height"
          class="h-auto w-full rounded-md"
          loading="lazy"
        />
        <figcaption
          v-if="str(b.data!.caption) || photos[str(b.data!.photoId)]!.credit"
          class="text-muted-foreground mt-2 space-x-2 text-sm"
        >
          <span v-if="str(b.data!.caption)"><GuideInline :html="str(b.data!.caption)" /></span>
          <PhotoCredit :credit="photos[str(b.data!.photoId)]!.credit" />
        </figcaption>
      </figure>
    </template>
  </div>
</template>
