<script setup lang="ts">
import type EditorJS from "@editorjs/editorjs";
import type { OutputData } from "@editorjs/editorjs";
import { guideBodySchema, type GuideBody } from "@repo/types";
import type { PhotoOption } from "~/utils/guidePhotoTool";

// The guide's body in Editor.js (docs/design/destination-guides.md, The
// editor): headings (levels 2 and 3; the title is the page's h1),
// paragraphs, lists, quotes and the guide's own photos, with bold, italic
// and links inline. Every change is checked against the body's schema
// before it's passed up to be saved.
//
// Editor.js is weaker for keyboard and screen-reader use than a plain form
// (decision 2026-10-03): acceptable because only the admin edits guides,
// and the public page is drawn by lokl's own renderer.
const props = defineProps<{ body: unknown; photos: PhotoOption[]; labelledby: string }>();
const emit = defineEmits<{ change: [body: GuideBody]; invalid: [message: string] }>();

const holder = ref<HTMLDivElement | null>(null);
const loadError = ref("");
let editor: EditorJS | null = null;
let ready = false;
// The photos, read by photo blocks when their list opens.
const photos = () => props.photos;

function toEditorData(body: unknown): OutputData {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  return { blocks: Array.isArray(blocks) ? (blocks as OutputData["blocks"]) : [] };
}

let changeTimer: ReturnType<typeof setTimeout> | undefined;
async function readBody() {
  if (!editor || !ready) return;
  const out = await editor.save();
  // Only the blocks: Editor.js's timestamp would make every save look like a change.
  const parsed = guideBodySchema.safeParse({ blocks: out.blocks });
  if (parsed.success) emit("change", parsed.data);
  else emit("invalid", `Not saved yet: ${parsed.error.issues[0]?.message ?? "one block can't be saved."}`);
}

onMounted(async () => {
  try {
    const [{ default: Editor }, { default: Header }, { default: List }, { default: Quote }] = await Promise.all([
      import("@editorjs/editorjs"),
      import("@editorjs/header"),
      import("@editorjs/list"),
      import("@editorjs/quote"),
    ]);
    editor = new Editor({
      holder: holder.value!,
      data: toEditorData(props.body),
      placeholder: "Start writing the guide. Press Tab for headings, lists, quotes and photos.",
      minHeight: 240,
      tools: {
        header: { class: Header as never, inlineToolbar: true, config: { levels: [2, 3], defaultLevel: 2, placeholder: "Heading" } },
        list: { class: List as never, inlineToolbar: true, config: { defaultStyle: "unordered", maxLevel: 1 } },
        quote: { class: Quote as never, inlineToolbar: true, config: { quotePlaceholder: "Quote", captionPlaceholder: "Who said it (optional)" } },
        photo: { class: GuidePhotoTool as never, config: { photos } },
      },
      onReady: () => {
        ready = true;
      },
      onChange: () => {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => void readBody(), 300);
      },
    });
  } catch (e) {
    loadError.value = reportProblem("The text editor didn't load. Reload the page to try again.", e);
  }
});

onBeforeUnmount(() => {
  clearTimeout(changeTimer);
  editor?.destroy();
  editor = null;
});

/** Replace the editor's content (copying a version into the draft). */
async function replace(body: unknown) {
  if (!editor) return;
  await editor.isReady;
  await editor.render(toEditorData(body));
}

/** Remove a deleted photo's blocks from the draft. Returns true if any were removed. */
async function removePhoto(photoId: string) {
  if (!editor) return false;
  const out = await editor.save();
  const next = out.blocks.filter((b) => !(b.type === "photo" && b.data?.photoId === photoId));
  if (next.length === out.blocks.length) return false;
  await editor.render({ blocks: next });
  await readBody();
  return true;
}

defineExpose({ replace, removePhoto, readBody });
</script>

<template>
  <div>
    <UiAlert v-if="loadError" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>{{ loadError }}</UiAlertTitle>
    </UiAlert>
    <div ref="holder" role="group" :aria-labelledby="labelledby" class="guide-body-editor" />
  </div>
</template>

<style scoped>
/* Tailwind's reset makes headings look like paragraphs; give the editor's
   headings and lists their sizes back, close to the public page's. */
.guide-body-editor :deep(h2.ce-header) {
  font-size: var(--text-xl);
  font-weight: 600;
  padding-top: calc(var(--spacing) * 3);
}
.guide-body-editor :deep(h3.ce-header) {
  font-size: var(--text-lg);
  font-weight: 600;
  padding-top: calc(var(--spacing) * 2);
}
.guide-body-editor :deep(.ce-paragraph),
.guide-body-editor :deep(.cdx-list) {
  line-height: 1.75;
}
.guide-body-editor :deep(a) {
  text-decoration: underline;
}
.guide-body-editor :deep(.guide-photo-block) {
  display: grid;
  gap: calc(var(--spacing) * 2);
  padding: calc(var(--spacing) * 3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin: calc(var(--spacing) * 2) 0;
}
.guide-body-editor :deep(.guide-photo-block select),
.guide-body-editor :deep(.guide-photo-block input) {
  border: 1px solid var(--color-input);
  border-radius: var(--radius-md);
  padding: calc(var(--spacing) * 2);
  background: var(--color-background);
}
.guide-body-editor :deep(.guide-photo-block label) {
  font-weight: 500;
  font-size: var(--text-sm);
}
.guide-body-editor :deep(.guide-photo-block img) {
  max-height: calc(var(--spacing) * 64);
  width: auto;
  border-radius: var(--radius-md);
}
.guide-body-editor :deep(.guide-photo-empty) {
  color: var(--color-muted-foreground);
  font-size: var(--text-sm);
}
</style>
