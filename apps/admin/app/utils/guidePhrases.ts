import type { StalePhrase } from "@repo/types";

/** A flagged phrase in a guide's draft, for the "Phrases to check" list: in the body (a block) or the title or teaser. */
export interface BodyPhrase extends StalePhrase {
  key: string;
  /** The Editor.js block id, or "title" / "teaser". */
  blockId: string;
  context: { before: string; phrase: string; after: string };
}
