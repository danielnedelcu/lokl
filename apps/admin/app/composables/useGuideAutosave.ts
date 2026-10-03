import type { TablesUpdate } from "@repo/types";

// Autosave for the guide editor (docs/design/destination-guides.md, The
// editor): changes save about 1.5 seconds after typing stops, one save at a
// time; anything changed during a save goes in the next one.
//
// - A failed save is retried, further apart each time; nothing is dropped.
// - Each save goes through only if the guide hasn't changed since this tab
//   last saw it (updated_at). If it has (another tab, say), saving stops and
//   the page asks to reload, rather than one tab overwriting the other.
// - A save the database refuses (a check, a taken web address) isn't
//   retried; its message is shown and the change stays waiting.

export type GuideFields = Pick<
  TablesUpdate<"guides">,
  | "slug"
  | "draft_title"
  | "draft_teaser"
  | "draft_body"
  | "draft_cover_photo_id"
  | "draft_area_id"
  | "draft_category_id"
  | "draft_listing_kind"
>;

export type SaveState = "saved" | "waiting" | "saving" | "retrying" | "failing" | "refused" | "conflict";

const DELAY_MS = 1500;
const RETRY_MS = [2000, 5000, 15000, 30000];

export function useGuideAutosave(guideId: string, updatedAt: string) {
  const supabase = useSupabaseClient();
  const state = ref<SaveState>("saved");
  const message = ref("");
  let known = updatedAt;
  let pending: GuideFields = {};
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  /** Queue changed fields. `now` saves straight away (a choice from a list, the cover). */
  function change(fields: GuideFields, now = false) {
    Object.assign(pending, fields);
    if (state.value === "conflict") return;
    if (state.value !== "retrying" && state.value !== "failing") state.value = "waiting";
    schedule(now ? 0 : DELAY_MS);
  }

  /** Drop a waiting change (a web address that turned out to be taken). */
  function discard(field: keyof GuideFields) {
    delete pending[field];
    if (!Object.keys(pending).length && state.value === "refused") state.value = "saved";
  }

  async function save() {
    const fields = pending;
    pending = {};
    state.value = "saving";
    const { data, error } = await supabase
      .from("guides")
      .update(fields)
      .eq("id", guideId)
      .eq("updated_at", known)
      .select("updated_at");
    if (!error && data?.length) {
      known = data[0]!.updated_at;
      attempts = 0;
      message.value = "";
      state.value = Object.keys(pending).length ? "waiting" : "saved";
      if (state.value === "waiting") schedule(DELAY_MS);
      return;
    }
    // Keep the change: anything newer stays on top.
    pending = { ...fields, ...pending };
    if (!error) {
      state.value = "conflict";
      message.value = "This guide was changed somewhere else, such as another tab. Reload to see the latest.";
      return;
    }
    // A refusal from the database's rules: retrying won't help.
    if (["23505", "23514", "23503", "22001", "42501"].includes(error.code)) {
      state.value = "refused";
      message.value = error.code === "23505" && "slug" in fields
        ? "That web address is already used by another guide. Choose a different one."
        : reportProblem(`Not saved: ${error.message}`, error);
      return;
    }
    reportProblem("Guide autosave failed", error);
    attempts++;
    state.value = attempts > RETRY_MS.length ? "failing" : "retrying";
    message.value = "";
    schedule(RETRY_MS[Math.min(attempts, RETRY_MS.length) - 1]!);
  }

  /** Save now, waiting for any save already running. True when everything is saved. */
  async function flush(): Promise<boolean> {
    clearTimeout(timer);
    while (running) await running;
    if (state.value === "conflict") return false;
    while (Object.keys(pending).length) {
      running = save().finally(() => (running = null));
      await running;
      // A failed save keeps its retry timer; otherwise save the rest now.
      if (state.value !== "saved" && state.value !== "waiting") break;
      clearTimeout(timer);
    }
    return state.value === "saved";
  }

  /** After a change made elsewhere on purpose (publishing, deleting a photo): the guide's new updated_at. */
  function rebase(newUpdatedAt: string) {
    known = newUpdatedAt;
  }

  /** Stop saving and forget waiting changes (the guide was deleted). */
  function stop() {
    clearTimeout(timer);
    pending = {};
    state.value = "saved";
  }

  const unsaved = computed(() => state.value !== "saved");

  // Leaving with unsaved changes asks first: closing the tab, or a link
  // inside the admin app.
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (unsaved.value) e.preventDefault();
  };
  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", beforeUnload);
    clearTimeout(timer);
  });
  onBeforeRouteLeave(() => {
    if (!unsaved.value) return true;
    return window.confirm("Some changes haven't saved yet. Leave anyway and lose them?");
  });

  return { state: readonly(state), message: readonly(message), unsaved, change, discard, flush, rebase, stop };
}
