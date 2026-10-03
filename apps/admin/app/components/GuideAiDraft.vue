<script setup lang="ts">
import { AI_BRIEF_MAX, aiDraftRequestSchema, type Guide } from "@repo/types";

// The editor's AI draft (docs/design/destination-guides.md, The AI draft): a
// "Write with AI" button floating at the bottom of the page opens a prompt
// bar there. The admin describes the guide in one box (the brief); the
// admin app's server asks Claude for a draft, using the area and category
// from Guide settings, and lands it in the guide's draft, marked
// unreviewed. The bar also lists this guide's AI drafts with their cost,
// and puts back the draft from before the latest one.
//
// This component stays mounted while the bar is closed, so a draft being
// written still lands if the bar is closed meanwhile.
const props = defineProps<{
  guide: Guide;
  /** The guide's area and category (Guide settings), sent with the brief. */
  areaId: string | null;
  categoryId: string | null;
  /** How the area and category read, e.g. "Old Fourth Ward · Any category". */
  scope: string;
  hasText: boolean;
  /** Saves waiting changes; returns the guide's updated_at, or null if it couldn't save. */
  prepare: () => Promise<string | null>;
}>();
const emit = defineEmits<{
  running: [running: boolean];
  landed: [result: { guide: Guide; suggestedSlug: string | null; phrases: number; costUsd: number | null }];
  restored: [guide: Guide];
}>();

const supabase = useSupabaseClient();
const open = ref(false);
const brief = ref("");
const error = ref("");
const failure = ref("");
const running = ref(false);
const confirmReplace = ref(false);
const textarea = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
const opener = ref<{ $el?: HTMLElement } | null>(null);

const field = () => {
  const el = (textarea.value as { $el?: HTMLElement })?.$el ?? (textarea.value as HTMLElement | null);
  return (el?.tagName === "TEXTAREA" ? el : el?.querySelector("textarea")) as HTMLTextAreaElement | null;
};
// Focus moves into the bar when it opens, and back to the button when it's
// closed by the admin (Escape or Close), once the swap animation is done.
let returnFocus = false;
function show() {
  open.value = true;
}
function hide() {
  returnFocus = true;
  open.value = false;
}
function onSwapped() {
  if (open.value) field()?.focus();
  else if (returnFocus) opener.value?.$el?.focus();
  returnFocus = false;
}
defineExpose({ show });

// ---------------------------------------------------------------------------
// This guide's AI drafts (the cost log)
// ---------------------------------------------------------------------------

interface LogRow {
  id: string;
  created_at: string;
  topic: string;
  error: string | null;
  cost_usd: number | null;
  reply: unknown;
  previous_draft: unknown;
  previous_draft_restored_at: string | null;
}
const log = ref<LogRow[]>([]);
async function loadLog() {
  const { data, error: e } = await supabase
    .from("guide_ai_drafts")
    .select("id, created_at, topic, error, cost_usd, reply, previous_draft, previous_draft_restored_at")
    .eq("guide_id", props.guide.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (e) return void reportProblem("Couldn't load this guide's AI drafts", e);
  log.value = data as LogRow[];
}
onMounted(loadLog);
const undoable = computed(() => {
  const latest = log.value.find((r) => r.previous_draft);
  return latest && !latest.previous_draft_restored_at ? latest : null;
});
const outcome = (r: LogRow) => (r.error ? "Not used" : r.reply ? (r.previous_draft ? "Written" : "Not used") : "Being written…");

// ---------------------------------------------------------------------------
// Writing a draft
// ---------------------------------------------------------------------------

function ask() {
  if (running.value) return;
  const parsed = aiDraftRequestSchema.shape.brief.safeParse(brief.value);
  error.value = parsed.success ? "" : (parsed.error.issues[0]?.message ?? "Check the description.");
  failure.value = "";
  if (!parsed.success) return;
  if (props.hasText) confirmReplace.value = true;
  else void write();
}
function onKeydown(e: KeyboardEvent) {
  // Enter sends; Shift+Enter is a new line. Escape closes the bar.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    ask();
  } else if (e.key === "Escape" && !running.value) {
    e.preventDefault();
    hide();
  }
}

async function write() {
  confirmReplace.value = false;
  running.value = true;
  emit("running", true);
  try {
    const expectedUpdatedAt = await props.prepare();
    if (!expectedUpdatedAt) {
      failure.value = "Your latest changes haven't saved yet. Wait for “Saved”, then try again.";
      return;
    }
    const result = await $fetch<{ guide: Guide; suggestedSlug: string | null; phrases: number; costUsd: number | null }>(
      `/api/guides/${props.guide.id}/draft`,
      {
        method: "POST",
        body: { brief: brief.value, areaId: props.areaId, categoryId: props.categoryId, expectedUpdatedAt },
        timeout: 300_000,
      },
    );
    emit("landed", result);
    useSonner.success("The AI draft is in. Review it before publishing.");
    brief.value = "";
    open.value = false;
  } catch (e) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    failure.value = reportProblem(err.data?.statusMessage ?? "The AI draft didn't work. Try again, or check the server logs.", e);
  } finally {
    running.value = false;
    emit("running", false);
    await loadLog();
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const confirmUndo = ref(false);
const undoing = ref(false);
async function undo() {
  const row = undoable.value;
  if (!row) return;
  undoing.value = true;
  try {
    const expectedUpdatedAt = await props.prepare();
    if (!expectedUpdatedAt) return void useSonner.error("Your latest changes haven't saved yet. Wait for “Saved”, then try again.");
    const { guide } = await $fetch<{ guide: Guide }>(`/api/guides/${props.guide.id}/restore-draft`, {
      method: "POST",
      body: { logId: row.id, expectedUpdatedAt },
    });
    emit("restored", guide);
    useSonner.success("The draft from before is back.");
    confirmUndo.value = false;
  } catch (e) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    useSonner.error(reportProblem(err.data?.statusMessage ?? "That didn't work. Try again, or check the server logs.", e));
  } finally {
    undoing.value = false;
    await loadLog();
  }
}

const money = (n: number | null) => (n == null ? "" : formatMoney(Math.round(n * 100)));
</script>

<template>
  <!-- A light veil over the page while the bar is open; clicks pass through. -->
  <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0" leave-active-class="transition duration-150"
    leave-to-class="opacity-0">
    <div v-if="open" class="bg-background/60 pointer-events-none fixed inset-0 z-20" aria-hidden="true" />
  </Transition>

  <!-- Fixed to the bottom of the viewport, centred over the page (beside
       the admin sidebar, w-60, from md up). The page leaves room below its
       text (pb-28 on the editor) so the button never covers the last lines. -->
  <div class="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4 md:left-60">
    <Transition mode="out-in" @after-enter="onSwapped" enter-active-class="transition duration-200 ease-out" enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in" leave-to-class="translate-y-2 opacity-0">
      <UiButton v-if="!open" ref="opener" variant="outline" class="pointer-events-auto rounded-full px-5 shadow-lg"
        @click="show">
        <Icon :name="running ? 'lucide:loader-circle' : 'lucide:sparkles'" :class="running && 'animate-spin'" aria-hidden="true" />
        {{ running ? "Writing the draft…" : "Write with AI" }}
      </UiButton>

      <section v-else aria-labelledby="ai-bar-heading"
        class="bg-background border-border pointer-events-auto w-full max-w-2xl space-y-3 rounded-2xl border p-3 shadow-lg">
        <h2 id="ai-bar-heading" class="sr-only">Write with AI</h2>
        <div>
          <UiLabel for="ai-brief" class="sr-only">What should the guide be about?</UiLabel>
          <UiTextarea id="ai-brief" ref="textarea" v-model="brief" :rows="3" :maxlength="AI_BRIEF_MAX" :disabled="running"
            class="resize-none border-0 shadow-none focus-visible:ring-0"
            placeholder="What should the guide be about? Add the angle, places you know, and what to mention or leave out."
            :aria-invalid="!!error || undefined" aria-describedby="ai-brief-hint" @keydown="onKeydown" />
        </div>
        <div class="flex flex-wrap items-end justify-between gap-2 px-1">
          <p id="ai-brief-hint" class="text-muted-foreground min-w-0 flex-1 text-xs">
            <span v-if="error" class="text-destructive block text-sm">{{ error }}</span>
            Uses {{ scope }} from Guide settings. Sent to Anthropic to write the draft: don't include anyone's personal details.
            Enter sends; Shift+Enter starts a new line.
          </p>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground text-xs tabular-nums">{{ brief.length.toLocaleString() }} / {{ AI_BRIEF_MAX.toLocaleString() }}</span>
            <UiButton size="icon-sm" variant="ghost" class="rounded-full" :disabled="running" aria-label="Close" @click="hide">
              <Icon name="lucide:x" aria-hidden="true" />
            </UiButton>
            <UiButton size="icon-sm" class="rounded-full" :disabled="running || !brief.trim()" aria-label="Write the draft" @click="ask">
              <Icon :name="running ? 'lucide:loader-circle' : 'lucide:arrow-up'" :class="running && 'animate-spin'" aria-hidden="true" />
            </UiButton>
          </div>
        </div>
        <p v-if="running" class="text-muted-foreground px-1 text-sm" role="status">
          Writing the draft. This usually takes under a minute; the editor is read-only until it's done.
        </p>
        <UiAlert v-if="failure" variant="destructive" icon="lucide:alert-circle">
          <UiAlertTitle>{{ failure }}</UiAlertTitle>
        </UiAlert>

        <details v-if="log.length" class="border-border border-t px-1 pt-2 text-sm">
          <summary class="text-muted-foreground cursor-pointer">AI drafts for this guide ({{ log.length }})</summary>
          <ul class="mt-2 space-y-1">
            <li v-for="r in log" :key="r.id" class="flex flex-wrap justify-between gap-x-2">
              <span class="min-w-0 truncate">{{ formatDateTime(r.created_at) }} · {{ outcome(r) }} · {{ r.topic }}</span>
              <span class="text-muted-foreground">{{ money(r.cost_usd) }}</span>
            </li>
          </ul>
          <UiButton v-if="undoable" size="sm" variant="outline" class="mt-2" :disabled="running || undoing" @click="confirmUndo = true">
            <Icon name="lucide:undo-2" aria-hidden="true" />Put back the draft from before
          </UiButton>
        </details>
      </section>
    </Transition>
  </div>

  <UiAlertDialog v-model:open="confirmReplace" title="Replace the current draft?"
    description="This replaces the draft's title, teaser and text. Your published guide isn't affected. You can put the current draft back afterwards.">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep my draft" />
        <UiAlertDialogAction text="Write a new draft" @click="write" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>

  <UiAlertDialog v-model:open="confirmUndo" title="Put back the draft from before?"
    :description="`This replaces the current draft with the one from before the AI draft of ${undoable ? formatDateTime(undoable.created_at) : ''}. Changes made since then are lost.`">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep the current draft" />
        <UiAlertDialogAction text="Put it back" variant="destructive" :disabled="undoing" @click.prevent="undo" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
