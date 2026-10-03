<script setup lang="ts">
import type EditorJS from "@editorjs/editorjs";
import type { OutputData } from "@editorjs/editorjs";
import { findStalePhrases, guideBodySchema, phraseContext, type GuideBody } from "@repo/types";
import type { PhotoOption } from "~/utils/guidePhotoTool";
import type { BodyPhrase } from "~/utils/guidePhrases";
import type { EditorLike } from "~/utils/guideEditorControl";

// The guide's body in Editor.js (docs/design/destination-guides.md, The
// editor): headings (levels 2 and 3; the title is the page's h1),
// paragraphs, lists, quotes and the guide's own photos, with bold, italic
// and links inline. Every change is checked against the body's schema
// before it's passed up to be saved.
//
// Editor.js is weaker for keyboard and screen-reader use than a plain form
// (decision 2026-10-03): acceptable because only the admin edits guides,
// and the public page is drawn by lokl's own renderer.
const props = defineProps<{
  body: unknown;
  photos: PhotoOption[];
  labelledby: string;
  /** Point out stale-looking phrases (while an AI draft waits for review). */
  highlight?: boolean;
}>();

const emit = defineEmits<{ change: [body: GuideBody]; invalid: [message: string]; phrases: [phrases: BodyPhrase[]] }>();

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

// ---------------------------------------------------------------------------
// Stale-looking phrases: found in each block's visible text and highlighted
// with the browser's highlight feature (CSS.highlights), which marks ranges
// without changing the text, so nothing extra is ever saved. Browsers
// without it still get the list, which is the main signal.
// ---------------------------------------------------------------------------

const HIGHLIGHT = "guide-stale";
const supportsHighlight = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
let ranges = new Map<string, Range>();

function textOf(el: Element) {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  return { text, nodes };
}
function rangeFor(nodes: { node: Text; start: number }[], start: number, end: number): Range | null {
  // The text node holding a character offset: the start falls inside a node,
  // the end may sit at a node's very end.
  const startAt = nodes.find((n) => start >= n.start && start < n.start + n.node.data.length);
  const endAt = nodes.find((n) => end > n.start && end <= n.start + n.node.data.length);
  if (!startAt || !endAt) return null;
  const r = document.createRange();
  r.setStart(startAt.node, start - startAt.start);
  r.setEnd(endAt.node, end - endAt.start);
  return r;
}

function scan() {
  if (!holder.value) return;
  ranges = new Map();
  const found: BodyPhrase[] = [];
  if (props.highlight) {
    for (const block of holder.value.querySelectorAll<HTMLElement>(".ce-block")) {
      const content = block.querySelector(".ce-block__content");
      if (!content) continue;
      const blockId = block.dataset.id ?? "";
      const { text, nodes } = textOf(content);
      findStalePhrases(text).forEach((p, i) => {
        const key = `${blockId}:${i}`;
        const r = rangeFor(nodes, p.start, p.end);
        if (r) ranges.set(key, r);
        found.push({ ...p, key, blockId, context: phraseContext(text, p) });
      });
    }
  }
  if (supportsHighlight()) {
    if (ranges.size) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges.values()));
    else CSS.highlights.delete(HIGHLIGHT);
  }
  emit("phrases", found);
}
watch(() => props.highlight, () => scan());

/** Scroll to a flagged phrase and select it. */
function reveal(key: string) {
  const r = ranges.get(key);
  if (!r) return;
  const el = r.startContainer.parentElement;
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.closest<HTMLElement>("[contenteditable]")?.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** While an AI draft is being written: no edits. */
// Changes to the editor's content or mode run one after another, in the
// order asked, and a new body is checked once drawn (utils/guideEditorControl).
const control = createEditorControl(() => editor as unknown as EditorLike | null);
/** While an AI draft is being written: no edits. */
const setReadOnly = (on: boolean) => control.setReadOnly(on);

let changeTimer: ReturnType<typeof setTimeout> | undefined;
async function readBody() {
  if (!editor || !ready) return;
  scan();
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
        scan();
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
  if (supportsHighlight()) CSS.highlights.delete(HIGHLIGHT);
  editor?.destroy();
  editor = null;
});

/** Replace the editor's content (copying a version into the draft). */
/** Draw a new body (an AI draft, a version, the draft before). True once the editor shows exactly it. */
async function replace(body: unknown) {
  const shown = await control.replace(body);
  scan();
  return shown;
}

/** Remove a deleted photo's blocks from the draft. Returns true if any were removed. */
async function removePhoto(photoId: string) {
  const next = await control.removePhoto(photoId);
  if (!next) return false;
  await readBody();
  return true;
}

defineExpose({ replace, removePhoto, readBody, reveal, setReadOnly });
</script>

<template>
  <div>
    <UiAlert v-if="loadError" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>{{ loadError }}</UiAlertTitle>
    </UiAlert>
    <div ref="holder" role="group" :aria-labelledby="labelledby" class="guide-body-editor" />
  </div>
</template>

<style>
/* Stale-looking phrases (CSS.highlights): a wavy underline and a tint, so
   the mark isn't colour alone. Not scoped: highlights belong to the page. */
::highlight(guide-stale) {
  background-color: color-mix(in oklab, var(--color-destructive) 15%, transparent);
  text-decoration: underline wavy var(--color-destructive);
  text-underline-offset: 3px;
}
</style>

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
