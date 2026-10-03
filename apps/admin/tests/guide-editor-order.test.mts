// The guide editor loading a new body (an AI draft landing), with real
// Editor.js in jsdom (found 2026-10-03: an AI draft's title showed but its
// body didn't, though both were saved). Reproduces the sequence: the draft
// lands while the editor is read-only, read-only turns off, the editor
// redraws; checks the body shown matches what's saved, and that autosave
// never sends a body while it's being loaded.
// Run: npx tsx apps/admin/tests/guide-editor-order.test.mts (part of `npm run test:ui`).

import { JSDOM } from "jsdom";
import * as vue from "vue";

// A browser for Editor.js, before it's loaded.
const dom = new JSDOM("<!doctype html><html><body><div id=holder></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLInputElement", "HTMLSelectElement",
  "HTMLImageElement", "Text", "Range", "Selection", "MutationObserver", "KeyboardEvent", "MouseEvent", "Event", "CustomEvent", "DOMParser",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "NodeFilter", "Option", "InputEvent", "FocusEvent", "ClipboardEvent"]) {
  // defineProperty: Node has some of these (navigator) as getters.
  if (key in w) Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : w[key], configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).getSelection = () => dom.window.getSelection();
// jsdom has no matchMedia; Editor.js only asks whether it's on a phone.
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
if (!(globalThis as Record<string, unknown>).ResizeObserver) (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const { default: EditorJS } = await import("@editorjs/editorjs");
const { default: Header } = await import("@editorjs/header");
const { default: List } = await import("@editorjs/list");
const { default: Quote } = await import("@editorjs/quote");
const { GuidePhotoTool } = await import("../app/utils/guidePhotoTool");
const { createEditorControl, sameBlocks } = await import("../app/utils/guideEditorControl");

// An AI draft as it lands: every kind of block the guide editor has.
const PHOTO = "0b1f6c1e-9a7e-4a3c-9a55-2c8f3d1e7a10";
const landed = {
  blocks: [
    { type: "paragraph", data: { text: "Atlanta rewards a weekend spent outside the car &amp; on foot." } },
    { type: "header", data: { text: "Parks, trails and gardens", level: 2 } },
    { type: "header", data: { text: "1. Walk the BeltLine Eastside Trail", level: 3 } },
    { type: "paragraph", data: { text: "Start early, when the trail is quiet." } },
    { type: "list", data: { style: "unordered", meta: {}, items: [{ content: "Wear comfortable shoes", meta: {}, items: [] }, { content: "Bring water", meta: {}, items: [] }] } },
    { type: "list", data: { style: "ordered", meta: { counterType: "numeric" }, items: [{ content: "Morning walk", meta: {}, items: [] }, { content: "Afternoon market", meta: {}, items: [] }] } },
    { type: "quote", data: { text: "The city is best on foot.", caption: "A local", alignment: "left" } },
    { type: "photo", data: { photoId: PHOTO, caption: "Murals by the trail" } },
  ],
};

// The guide editor's own set-up (GuideBodyEditor.vue), with an onChange we can watch.
let onChange: () => void = () => {};
async function makeEditor(holderId: string) {
  const holder = document.createElement("div");
  holder.id = holderId;
  document.body.appendChild(holder);
  const editor = new EditorJS({
    holder,
    data: { blocks: [] },
    tools: {
      header: { class: Header as never, inlineToolbar: true, config: { levels: [2, 3], defaultLevel: 2 } },
      list: { class: List as never, inlineToolbar: true, config: { defaultStyle: "unordered", maxLevel: 1 } },
      quote: { class: Quote as never, inlineToolbar: true },
      photo: { class: GuidePhotoTool as never, config: { photos: () => [{ id: PHOTO, url: "http://localhost/p.webp", alt: "Murals" }] } },
    },
    onChange: () => onChange(),
  });
  await editor.isReady;
  return { editor, holder };
}

// ---------------------------------------------------------------------------
// A. The old order: the draft lands and read-only turns off at the same time.
// ---------------------------------------------------------------------------
{
  const { editor, holder } = await makeEditor("old");
  await editor.readOnly.toggle(true); // while the draft is being written
  // What used to happen: drawing the new body, and turning read-only off, unordered.
  await Promise.all([editor.render(landed), editor.readOnly.toggle(false)]);
  await tick();
  const shown = await editor.save();
  check(!sameBlocks(shown, landed), `A. the old order reproduces the bug: the editor shows ${shown.blocks.length} blocks, not the ${landed.blocks.length} saved`);
  void holder;
}

// ---------------------------------------------------------------------------
// B. The fix: the same events, through the editor control.
// ---------------------------------------------------------------------------
{
  const { editor, holder } = await makeEditor("new");
  const control = createEditorControl(() => editor as never);
  await control.setReadOnly(true); // the AI draft is requested
  // The draft lands and read-only turns off, asked for back to back, as the page does.
  const drawn = control.replace(landed);
  const unlocked = control.setReadOnly(false);
  const [shownOk] = await Promise.all([drawn, unlocked]);
  await tick();
  const shown = await editor.save();
  check(shownOk === true, "B1. the control reports the new body is shown");
  check(sameBlocks(shown, landed), `B2. the editor shows exactly the saved body (${shown.blocks.length} of ${landed.blocks.length} blocks, same content)`);
  check(editor.readOnly.isEnabled === false, "B3. ...and the editor is editable again");
  check(holder.textContent!.includes("Parks, trails and gardens") && holder.textContent!.includes("Start early"), "B4. the text is on the page, not just in the editor's data");
}

// ---------------------------------------------------------------------------
// C. Autosave never sends a body while one is being loaded.
// ---------------------------------------------------------------------------
{
  // The real autosave composable, with Vue and a fake database: every
  // update it sends is recorded.
  const sent: Record<string, unknown>[] = [];
  const g = globalThis as Record<string, unknown>;
  Object.assign(g, {
    ref: vue.ref, computed: vue.computed, readonly: vue.readonly,
    onMounted: () => {}, onBeforeUnmount: () => {}, onBeforeRouteLeave: () => {},
    reportProblem: (m: string) => m,
    useSupabaseClient: () => ({
      from: () => ({
        update: (fields: Record<string, unknown>) => {
          sent.push(fields);
          const chain = { eq: () => chain, select: async () => ({ data: [{ updated_at: `t${sent.length}` }], error: null }) };
          return chain;
        },
      }),
    }),
  });
  const { useGuideAutosave } = await import("../app/composables/useGuideAutosave");
  const autosave = useGuideAutosave("guide-1", "t0");

  const { editor } = await makeEditor("guarded");
  const control = createEditorControl(() => editor as never);
  // The page's handler (onBody): body changes from the editor go to autosave unless held.
  onChange = async () => {
    if (autosave.bodyHeld.value) return;
    autosave.change({ draft_body: (await editor.save()) as never });
  };

  autosave.holdBody(); // the AI draft is requested
  await control.setReadOnly(true);
  // The timing goes wrong anyway: the old unordered steps, firing the editor's onChange mid-redraw...
  // Editor.js may throw from its own timers on overlapping redraws like
  // these; only what gets saved matters here, so those errors are noted, not fatal.
  let misuseErrors = 0;
  const swallow = () => void misuseErrors++;
  process.on("uncaughtException", swallow);
  process.on("unhandledRejection", swallow);
  await Promise.allSettled([editor.render({ blocks: [] }), editor.readOnly.toggle(false), editor.render(landed)]);
  await tick(300);
  process.off("uncaughtException", swallow);
  process.off("unhandledRejection", swallow);
  console.log(`     (the deliberately overlapping redraws raised ${misuseErrors} error(s) inside Editor.js)`);
  // ...and a body change sent straight to autosave, as if a handler slipped through.
  autosave.change({ draft_body: { blocks: [] } as never, draft_title: "Ten things to do on a weekend in Atlanta" });
  await autosave.flush();
  check(sent.length > 0 && sent.every((u) => !("draft_body" in u)), `C1. while held, nothing sent carries a body (${sent.length} save(s): ${sent.map((u) => Object.keys(u).join("+")).join(", ")})`);
  check(sent.some((u) => u.draft_title === "Ten things to do on a weekend in Atlanta"), "C2. ...while the other fields still save");

  // Loaded and checked: edits save again.
  const shownOk = await control.replace(landed);
  if (shownOk) autosave.releaseBody();
  const before = sent.length;
  autosave.change({ draft_body: landed as never });
  await autosave.flush();
  check(shownOk && sent.length === before + 1 && "draft_body" in sent.at(-1)!, "C3. once the editor shows the saved body, an edit to it saves");
}

console.log(failures ? `${failures} failed` : "All guide editor order checks passed.");
process.exit(failures ? 1 : 0);
