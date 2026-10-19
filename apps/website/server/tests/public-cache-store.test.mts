// The public cache's bookkeeping (apps/website/server/utils/publicCacheStore.ts),
// on a fake clock: an answer is reused while its versions are unchanged and
// within 60 seconds; other versions or an older answer are built fresh; the
// least recently used address is dropped first; and the content versions
// are read at most once a second, a failed read not kept.
// Run: npx tsx apps/website/server/tests/public-cache-store.test.mts (part of test:ui)

import { memoizedVersions, PUBLIC_CACHE_MAX_AGE_MS, PublicCacheStore } from "../utils/publicCacheStore";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

// 1. Reused while the versions are unchanged and within 60 seconds.
const store = new PublicCacheStore<string>(3);
store.set("/browse", "listings1", "answer", 1_000);
check(store.get("/browse", "listings1", 1_000) === "answer", "1a. reused straight away with the same versions");
check(store.get("/browse", "listings1", 1_000 + PUBLIC_CACHE_MAX_AGE_MS - 1) === "answer", "1b. ...and just under 60 seconds later");
check(store.get("/browse", "listings2", 2_000) === undefined, "1c. built fresh when a version has changed");
store.set("/browse", "listings2", "fresh", 2_000);
check(store.get("/browse", "listings2", 2_000 + PUBLIC_CACHE_MAX_AGE_MS) === undefined, "1d. built fresh once 60 seconds have passed");
check(!store.has("/browse"), "1e. ...and the stale answer is let go");

// 2. The least recently used address goes first.
const lru = new PublicCacheStore<string>(3);
lru.set("/a", "v", "a", 0);
lru.set("/b", "v", "b", 0);
lru.set("/c", "v", "c", 0);
lru.get("/a", "v", 1); // used: now the most recent
lru.set("/d", "v", "d", 2);
check(lru.size === 3, "2a. never more than the limit");
check(lru.has("/a") && !lru.has("/b"), "2b. the least recently used (/b) is dropped, not the oldest written (/a)");
check(lru.has("/c") && lru.has("/d"), "2c. ...and the others are kept");

// 3. An error isn't kept; a newer answer for the same address is.
const errs = new PublicCacheStore<string>(3);
errs.set("/x", "v", "first", 0);
errs.set("/x", "v", "second", 0);
errs.forget("/x", "first");
check(errs.get("/x", "v", 1) === "second", "3a. forgetting a failed answer leaves a newer one in place");
errs.forget("/x", "second");
check(!errs.has("/x"), "3b. a failed answer is forgotten");

// 4. Versions read at most once a second, shared, a failure not kept, and
// each read through the request that needs it.
let reads = 0;
let fail = false;
/** A request's own loader: what it reads, tagged with which request read it. */
const requestLoader = (request: string) => async () => {
  reads++;
  if (fail) throw new Error("down");
  return { listings: reads, [request]: 1 };
};
const versions = memoizedVersions();
const [v1, v2] = await Promise.all([versions(10_000, requestLoader("first")), versions(10_500, requestLoader("second"))]);
check(reads === 1 && v1.listings === 1 && v2.listings === 1, "4a. one read shared within a second, in flight included");
check(v2.first === 1 && v2.second === undefined, "4b. ...through the first request's loader, the second's not called");
const later = await versions(11_000, requestLoader("later"));
check(later.listings === 2 && later.later === 1 && later.first === undefined, "4c. read again once a second has passed, through the later request's own loader");
fail = true;
const failed = await versions(12_000, requestLoader("failing")).then(() => false, () => true);
fail = false;
check(failed && (await versions(12_100, requestLoader("next"))).next === 1, "4d. a failed read isn't kept: the next request reads again, through its own loader");

console.log(failures ? `${failures} failed` : "All public cache store checks passed.");
process.exit(failures ? 1 : 0);
