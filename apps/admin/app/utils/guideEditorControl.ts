// How the guide editor changes Editor.js's content and mode, kept apart from
// the Vue component so a test can drive real Editor.js with it
// (apps/admin/tests/guide-editor-order.test.mts).
//
// Every change (read-only on or off, a new body, removing a photo) runs one
// after another, in the order asked. Turning read-only off makes Editor.js
// redraw the blocks it holds at that moment; run alongside a new body being
// drawn (an AI draft landing), it drew the old, empty content over the new
// body (found 2026-10-03: the title showed, the body didn't, both saved).
// A new body is drawn only once the editor is editable (so nothing redraws
// over it afterwards), then it checks what the editor now shows matches it,
// and draws it once more if not.

export interface EditorBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

/** The part of Editor.js this uses. */
export interface EditorLike {
  isReady: Promise<unknown>;
  render(data: { blocks: EditorBlock[] }): Promise<void>;
  save(): Promise<{ blocks: EditorBlock[] }>;
  readOnly: { isEnabled: boolean; toggle(state?: boolean): Promise<boolean> };
}

const blocksOf = (body: unknown): EditorBlock[] => {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? (blocks as EditorBlock[]) : [];
};

/** The same content, ignoring block ids (Editor.js may give new ones). */
export function sameBlocks(a: unknown, b: unknown): boolean {
  const strip = (body: unknown) => JSON.stringify(blocksOf(body).map((x) => ({ type: x.type, data: x.data })));
  return strip(a) === strip(b);
}

export function createEditorControl(getEditor: () => EditorLike | null) {
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(step: () => Promise<T>): Promise<T> {
    const run = queue.then(step, step);
    queue = run.catch(() => undefined);
    return run;
  }

  function setReadOnly(on: boolean) {
    return inTurn(async () => {
      const editor = getEditor();
      if (!editor) return;
      await editor.isReady;
      if (editor.readOnly.isEnabled !== on) await editor.readOnly.toggle(on);
    });
  }

  /**
   * Draw a new body. Resolves true once the editor shows exactly it, false if
   * it can't. A new body is only drawn into an editable editor: turning
   * read-only off redraws what's there (so it must come first), and Editor.js
   * can't read its content back while read-only (so the check needs it).
   */
  function replace(body: unknown) {
    return inTurn(async () => {
      const editor = getEditor();
      if (!editor) return false;
      await editor.isReady;
      if (editor.readOnly.isEnabled) await editor.readOnly.toggle(false);
      const blocks = blocksOf(body);
      for (let attempt = 0; attempt < 2; attempt++) {
        await editor.render({ blocks });
        if (sameBlocks(await editor.save(), { blocks })) return true;
      }
      return false;
    });
  }

  /** Take a deleted photo's blocks out. Resolves to the new body, or null if it wasn't used. */
  function removePhoto(photoId: string) {
    return inTurn(async () => {
      const editor = getEditor();
      if (!editor) return null;
      const out = await editor.save();
      const next = out.blocks.filter((b) => !(b.type === "photo" && b.data?.photoId === photoId));
      if (next.length === out.blocks.length) return null;
      await editor.render({ blocks: next });
      return { blocks: next };
    });
  }

  return { setReadOnly, replace, removePhoto };
}
