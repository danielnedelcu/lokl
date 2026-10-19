    import type { ServerEvent } from "./provider";
    import { memoizedVersions, PublicCacheStore } from "./publicCacheStore";

    // The public routes' cache (decided 2026-10-18; migration
    // public_content_versions). Each answer is kept for up to 60 seconds, but
    // only while the content it was built from hasn't changed: the database
    // raises a scope's number (listings, markets, guides) whenever that content
    // changes, and an entry built under other numbers is answered fresh. The
    // numbers are read at most once a second per running copy, so a listing
    // taken down, a provider suspended or a guide published shows within about
    // a second, on every running copy of the website. Spots left and open days
    // aren't scopes: they follow the 60 seconds.
    //
    // Not cacheable at the edge (Cache-Control: private, no-cache) until hosting
    // is chosen: a CDN can't see the numbers (docs/TODO.md, staging). Errors are
    // never kept, so a page that has become a 404 says so at once.

    export type ContentScope = "listings" | "markets" | "guides";

    const store = new PublicCacheStore<Promise<unknown>>();
    const versionsOf = memoizedVersions();

    /** The current numbers of these scopes, as "listings12.markets3". */
    async function contentVersions(event: ServerEvent, scopes: ContentScope[], now: number): Promise<string> {
      // This request's own client, used only if a read is due.
      const all = await versionsOf(now, async () => {
        // bounded: three fixed rows
        const { data, error } = await usePublicDb(event).from("public_content_versions").select("scope, version");
        if (error) throw publicFailure(error);
        return Object.fromEntries(data.map((r) => [r.scope, r.version]));
      });
      return scopes.map((s) => {
        if (all[s] === undefined) throw publicFailure(new Error(`No content version for ${s}.`));
        return `${s}${all[s]}`;
      }).join(".");
    }

    /**
     * A public GET route, cached for up to 60 seconds per address while the
     * named scopes are unchanged. Name every scope whose content the answer
     * shows (scripts/check-public-cache.mjs checks the tables behind them).
     */
    export function definePublicCachedHandler<T>(scopes: ContentScope[], handler: (event: ServerEvent) => Promise<T>) {
      return defineEventHandler(async (event): Promise<T> => {
        // real time: the cache's own age, not a rule.
        const now = Date.now();
        const versions = await contentVersions(event, scopes, now);
        setResponseHeader(event, "cache-control", "private, no-cache");
        const key = event.path;
        const hit = store.get(key, versions, now);
        if (hit) return hit as Promise<T>;
        const value = handler(event);
        store.set(key, versions, value, now);
        try {
          return await value;
        } catch (e) {
          store.forget(key, value);
          throw e;
        }
      });
    }
