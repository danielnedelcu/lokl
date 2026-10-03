import { z } from "zod";

// AI drafts of destination guides (docs/design/destination-guides.md, The
// AI draft and Review): the request the editor sends, and the second pass
// that points out phrases likely to go stale. The scanner never changes the
// text; the editor lists what it finds while a draft waits for review.

/** At most this many AI draft requests an hour, across every guide (decided 2026-10-03). */
export const AI_DRAFTS_PER_HOUR = 10;
/** A request without a result this recent counts as still being written. */
export const AI_DRAFT_RUNNING_MS = 3 * 60 * 1000;

export const aiDraftRequestSchema = z.object({
  topic: z.string().trim().min(3, "Enter a topic of at least 3 characters.").max(200, "Keep the topic under 200 characters."),
  areaId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  notes: z.string().trim().max(4000, "Keep the notes under 4,000 characters.").optional().or(z.literal("")),
  /** The guide's updated_at as the editor last saw it: the draft lands only if it hasn't changed since. */
  expectedUpdatedAt: z.string().min(1),
});
export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>;

// ---------------------------------------------------------------------------
// The stale-phrase scanner
// ---------------------------------------------------------------------------

export type StaleKind = "price" | "time" | "schedule" | "date" | "contact" | "address" | "dating" | "ranking" | "cliche";

export const STALE_REASONS: Record<StaleKind, string> = {
  price: "A price can change.",
  time: "Hours can change.",
  schedule: "Schedules can change.",
  date: "A date: check it's right, and that it won't date the guide.",
  contact: "Contact details don't belong in a guide.",
  address: "Addresses can change.",
  dating: "This will date the guide.",
  ranking: "A ranking lokl can't stand behind.",
  cliche: "A stock phrase: say something specific instead.",
};

export interface StalePhrase {
  start: number;
  end: number;
  phrase: string;
  kind: StaleKind;
  reason: string;
}

const DAYS = "(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays|weekends)";
const MONTHS = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
const STREET = "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Parkway|Pkwy|Court|Ct|Highway|Hwy)";

// Each pattern, with what it means. "i" = ignore case. Order matters only
// for overlaps: the earlier, more specific pattern wins.
const PATTERNS: [StaleKind, RegExp][] = [
  // Contact details first, so a phone number isn't read as a time.
  ["contact", /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+|\b[a-z0-9-]+\.(?:com|org|net|io|co|us|info)\b/gi],
  ["contact", /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g],
  ["contact", /(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g],
  ["address", new RegExp(`\\b\\d{1,5}\\s+(?:[A-Z][\\w'-]*\\s+){1,3}${STREET}\\b\\.?`, "g")],
  ["price", /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|bucks|cents)\b/gi],
  ["price", /\bfree (?:admission|entry|of charge)\b|\b(?:admission|entry|tickets?) (?:is|are|costs?|runs?)\b|\b(?:cover charge|entrance fee)\b/gi],
  ["schedule", new RegExp(`\\b${DAYS}\\s+(?:at|from|until|till|before|after|between)\\s+\\d{1,2}(?::\\d{2})?(?:\\s?[ap]\\.?m\\.?)?`, "gi")],
  ["time", /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b/gi],
  ["time", /\b(?:until|till) (?:\d{1,2}\b|midnight|noon)|\b(?:opens?|closes?|closed|open) (?:daily|every day|late|early|until|at|on)\b|\bopening hours\b/gi],
  ["date", new RegExp(`\\b${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi")],
  ["date", /\b(?:19|20)\d{2}\b(?!s)/g],
  ["dating", /\b(?:this|next|last) (?:year|season|spring|summer|fall|autumn|winter|month|week|weekend)\b/gi],
  ["dating", /\b(?:brand-new|newly|newest|currently|recently|upcoming|just opened|now open|these days|nowadays|at the moment|for now)\b/gi],
  ["dating", /\b(?:new|now|latest)\b/gi],
  ["ranking", /\b(?:top-rated|highest-rated|best-known|must-see|must-visit|must-try|must-do|number one|award-winning|world-class|world-famous)\b|#1\b/gi],
  ["ranking", /\b(?:best|top|greatest|finest|unbeatable|ultimate|unmissable)\b(?! of the (?:hill|stairs|street|page))(?! floor)/gi],
  ["cliche", /\b(?:hidden gems?|vibrant|bustling|nestled|something for everyone|(?:a )?feast for the senses|whether you(?:'re| are) a local or a visitor|off the beaten path|best-kept secret|melting pot|tapestry|look no further|a stone's throw)\b/gi],
];

// "Best Friend Park", "New York", "Top Golf": a flagged word starting a
// capitalised name is a name, not a claim (unless it starts the sentence).
const NAME_WORDS = new Set(["best", "top", "new", "now", "latest", "greatest", "finest", "ultimate"]);
function isNamePart(text: string, start: number, end: number): boolean {
  const word = text.slice(start, end);
  if (!NAME_WORDS.has(word.toLowerCase()) || !/^[A-Z]/.test(word)) return false;
  const next = /^\s+([A-Z][a-z]+)/.exec(text.slice(end));
  if (!next) return false;
  const before = text.slice(0, start).trimEnd();
  const sentenceStart = before === "" || /[.!?:]["')\]]?$/.test(before);
  // At a sentence start "Best Friend Park" and "Best Of" look alike; a
  // following capitalised word that isn't a common word means a name.
  return !sentenceStart || !["Of", "And", "To", "In", "For", "The", "A"].includes(next[1]!);
}

/** Phrases in plain text that are likely to go stale or shouldn't be in a guide, in order, without overlaps. */
export function findStalePhrases(text: string): StalePhrase[] {
  const found: StalePhrase[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].replace(/[.,;:]+$/, "").length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      if (isNamePart(text, start, end)) continue;
      found.push({ start, end, phrase: text.slice(start, end), kind, reason: STALE_REASONS[kind] });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The sentence around a phrase, shortened, for the editor's "Phrases to check" list. */
export function phraseContext(text: string, p: Pick<StalePhrase, "start" | "end">, room = 60): { before: string; phrase: string; after: string } {
  const from = Math.max(0, p.start - room);
  const to = Math.min(text.length, p.end + room);
  return {
    before: `${from > 0 ? "…" : ""}${text.slice(from, p.start).replace(/^\S*\s/, from > 0 ? "" : "$&")}`,
    phrase: text.slice(p.start, p.end),
    after: `${text.slice(p.end, to).replace(/\s\S*$/, to < text.length ? "" : "$&")}${to < text.length ? "…" : ""}`,
  };
}
