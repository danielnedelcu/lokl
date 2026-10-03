<script setup lang="ts">
import { aiDraftRequestSchema, type Category, type Guide, type ServiceArea } from "@repo/types";

// The editor's "AI draft" panel (docs/design/destination-guides.md, The AI
// draft): topic, area, category and notes go to the admin app's server,
// which asks Claude for a draft and lands it in the guide's draft, marked
// unreviewed. Also lists this guide's AI drafts with their cost, and puts
// back the draft from before the latest one.
const props = defineProps<{
  guide: Guide;
  /** The draft's current choices, used as the form's starting values. */
  draftTitle: string;
  draftAreaId: string | null;
  draftCategoryId: string | null;
  hasText: boolean;
  areas: ServiceArea[];
  categories: Category[];
  /** Saves waiting changes; returns the guide's updated_at, or null if it couldn't save. */
  prepare: () => Promise<string | null>;
}>();
const emit = defineEmits<{
  running: [running: boolean];
  landed: [result: { guide: Guide; suggestedSlug: string | null; phrases: number; costUsd: number | null }];
  restored: [guide: Guide];
  useSlug: [slug: string];
}>();

const supabase = useSupabaseClient();
const open = ref(false);
const topic = ref("");
const areaId = ref<string | null>(null);
const categoryId = ref<string | null>(null);
const notes = ref("");
const errors = ref<Record<string, string>>({});
const failure = ref("");
const running = ref(false);
const confirmReplace = ref(false);
const suggestedSlug = ref<string | null>(null);

watch(open, (o) => {
  if (!o) return;
  // Start from the draft's own choices each time the panel opens.
  topic.value = topic.value || props.draftTitle;
  areaId.value = props.draftAreaId;
  categoryId.value = props.draftCategoryId;
});

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
  const { data, error } = await supabase
    .from("guide_ai_drafts")
    .select("id, created_at, topic, error, cost_usd, reply, previous_draft, previous_draft_restored_at")
    .eq("guide_id", props.guide.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return void reportProblem("Couldn't load this guide's AI drafts", error);
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
  const parsed = aiDraftRequestSchema.omit({ expectedUpdatedAt: true }).safeParse({
    topic: topic.value,
    areaId: areaId.value,
    categoryId: categoryId.value,
    notes: notes.value,
  });
  errors.value = {};
  failure.value = "";
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.value[String(i.path[0])] = i.message;
    return;
  }
  if (props.hasText) confirmReplace.value = true;
  else void write();
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
        body: { topic: topic.value, areaId: areaId.value, categoryId: categoryId.value, notes: notes.value, expectedUpdatedAt },
        timeout: 300_000,
      },
    );
    suggestedSlug.value = result.suggestedSlug;
    emit("landed", result);
    useSonner.success("The AI draft is in. Review it before publishing.");
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
    suggestedSlug.value = null;
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

const areaLabel = (a: ServiceArea) => `${a.name}${a.active ? "" : " (hidden from the site)"}`;
const categoryLabel = (c: Category) => `${c.name}${c.active ? "" : " (hidden from the site)"}`;
const money = (n: number | null) => (n == null ? "" : formatMoney(Math.round(n * 100)));
</script>

<template>
  <section aria-labelledby="ai-heading" class="border-border space-y-3 rounded-lg border p-4">
    <div class="flex items-center justify-between gap-2">
      <h2 id="ai-heading" class="flex items-center gap-1 font-medium">
        <Icon name="lucide:sparkles" aria-hidden="true" />AI draft
      </h2>
      <UiButton v-if="!open" size="sm" variant="outline" :disabled="running" @click="open = true">Write a draft</UiButton>
    </div>

    <p v-if="suggestedSlug && !guide.published_at && suggestedSlug !== guide.slug" class="flex flex-wrap items-center gap-1 text-sm">
      Suggested address: <code class="bg-muted rounded px-1">{{ suggestedSlug }}</code>
      <UiButton size="sm" variant="link" @click="emit('useSlug', suggestedSlug!); suggestedSlug = null">Use it</UiButton>
    </p>

    <form v-if="open" class="space-y-3" novalidate @submit.prevent="ask">
      <div>
        <UiLabel for="ai-topic" class="mb-2">Topic</UiLabel>
        <UiInput id="ai-topic" v-model="topic" :maxlength="200" :disabled="running" placeholder="A day in Old Fourth Ward"
          :aria-invalid="!!errors.topic || undefined" :aria-describedby="errors.topic ? 'ai-topic-error' : undefined" />
        <p v-if="errors.topic" id="ai-topic-error" class="text-destructive mt-1.5 text-sm">{{ errors.topic }}</p>
      </div>
      <div>
        <UiLabel for="ai-area" class="mb-2">Area</UiLabel>
        <UiNativeSelect id="ai-area" v-model="areaId" :disabled="running">
          <option :value="null">None</option>
          <option v-for="a in areas" :key="a.id" :value="a.id">{{ areaLabel(a) }}</option>
        </UiNativeSelect>
      </div>
      <div>
        <UiLabel for="ai-category" class="mb-2">Category</UiLabel>
        <UiNativeSelect id="ai-category" v-model="categoryId" :disabled="running">
          <option :value="null">None</option>
          <optgroup label="Services">
            <option v-for="c in categories.filter((c) => c.kind === 'service')" :key="c.id" :value="c.id">{{ categoryLabel(c) }}</option>
          </optgroup>
          <optgroup label="Experiences">
            <option v-for="c in categories.filter((c) => c.kind === 'experience')" :key="c.id" :value="c.id">{{ categoryLabel(c) }}</option>
          </optgroup>
        </UiNativeSelect>
      </div>
      <div>
        <UiLabel for="ai-notes" class="mb-2">Your notes (optional)</UiLabel>
        <UiTextarea id="ai-notes" v-model="notes" :rows="5" :maxlength="4000" :disabled="running"
          placeholder="The angle, places you know, what to mention or leave out." aria-describedby="ai-notes-hint" />
        <p id="ai-notes-hint" class="text-muted-foreground mt-1.5 text-sm">
          Sent to Anthropic to write the draft. Don't include anyone's personal details.
          <template v-if="errors.notes"><br><span class="text-destructive">{{ errors.notes }}</span></template>
        </p>
      </div>
      <p class="text-muted-foreground text-sm">
        The draft replaces the draft's title, teaser and text, and uses the area and category above. It's marked unreviewed until you
        check it.
      </p>
      <div class="flex flex-wrap gap-2">
        <UiButton type="submit" :disabled="running">
          <Icon v-if="running" name="lucide:loader-circle" class="animate-spin" aria-hidden="true" />
          {{ running ? "Writing the draft…" : "Write a draft" }}
        </UiButton>
        <UiButton type="button" variant="ghost" :disabled="running" @click="open = false">Cancel</UiButton>
      </div>
      <p v-if="running" class="text-muted-foreground text-sm" role="status">
        This usually takes under a minute. The editor is read-only until it's done.
      </p>
    </form>

    <UiAlert v-if="failure" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>{{ failure }}</UiAlertTitle>
    </UiAlert>

    <div v-if="log.length" class="border-border space-y-2 border-t pt-3 text-sm">
      <p class="font-medium">AI drafts for this guide</p>
      <ul class="space-y-1">
        <li v-for="r in log" :key="r.id" class="flex flex-wrap justify-between gap-x-2">
          <span>{{ formatDateTime(r.created_at) }} · {{ outcome(r) }}</span>
          <span class="text-muted-foreground">{{ money(r.cost_usd) }}</span>
        </li>
      </ul>
      <UiButton v-if="undoable" size="sm" variant="outline" :disabled="running || undoing" @click="confirmUndo = true">
        <Icon name="lucide:undo-2" aria-hidden="true" />Put back the draft from before
      </UiButton>
    </div>
  </section>

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
