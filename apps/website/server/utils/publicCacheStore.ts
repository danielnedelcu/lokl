// The bookkeeping behind the public routes' cache (publicCache.ts), with no
// Nuxt or Supabase in it, so it's tested on its own with a fake clock
// (apps/website/server/tests/public-cache-store.test.mts).

/** An answer is kept this long, and only while its content versions are unchanged. */
export const PUBLIC_CACHE_MAX_AGE_MS = 60_000;
/** Distinct addresses kept (browse and search vary by query); the least recently used go first. */
export const PUBLIC_CACHE_MAX_ENTRIES = 500;
/** The content versions are read from the database at most this often per running copy. */
export const CONTENT_VERSIONS_MAX_AGE_MS = 1_000;

interface Entry<V> {
  versions: string;
  at: number;
  value: V;
}

/** Answers by address, each valid for its versions and 60 seconds; least recently used dropped first. */
export class PublicCacheStore<V> {
  private entries = new Map<string, Entry<V>>();
  constructor(private maxEntries = PUBLIC_CACHE_MAX_ENTRIES, private maxAgeMs = PUBLIC_CACHE_MAX_AGE_MS) {}

  /** The answer kept for this address, if it was built under these versions in the last 60 seconds. */
  get(key: string, versions: string, now: number): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.versions !== versions || now - hit.at >= this.maxAgeMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Used: now the most recent (a Map keeps insertion order).
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, versions: string, value: V, now: number) {
    this.entries.delete(key);
    this.entries.set(key, { versions, at: now, value });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  /** Forgets this address's answer if it's still this one (an error isn't kept). */
  forget(key: string, value: V) {
    if (this.entries.get(key)?.value === value) this.entries.delete(key);
  }

  get size() {
    return this.entries.size;
  }

  has(key: string) {
    return this.entries.has(key);
  }
}

/**
 * The content versions, read at most once a second per running copy: one
 * read shared by every request in that second (and by requests arriving
 * while it's in flight). A failed read isn't kept. Each request hands in
 * its own loader, so a read that's due uses that request's client, never
 * an earlier request's.
 */
export function memoizedVersions(maxAgeMs = CONTENT_VERSIONS_MAX_AGE_MS) {
  let kept: { at: number; value: Promise<Record<string, number>> } | null = null;
  return (now: number, load: () => Promise<Record<string, number>>): Promise<Record<string, number>> => {
    if (kept && now - kept.at < maxAgeMs) return kept.value;
    const value = load();
    const mine = { at: now, value };
    kept = mine;
    value.catch(() => {
      if (kept === mine) kept = null;
    });
    return value;
  };
}
