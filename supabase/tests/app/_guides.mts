// Removing the app tests' published guides, against the local stack.
// Published guides can't be deleted and versions are append-only, so this
// runs with triggers off for its own session (replica), never with `alter
// table … disable trigger`: that's a schema change, and PostgREST reloads
// and resets its connections, failing other tests' requests mid-run
// (check:test-ddl). Replica also skips the foreign keys' cascades and the
// content-version bump, so it removes the children itself and raises the
// guides version afterwards. The browser tests' copy is in e2e/support/data.ts.

/** SQL that removes the guides in `ids` (a parenthesised list or subquery); run it in one transaction. */
export function removeGuidesSql(ids: string) {
  return `
    set session_replication_role = replica;
    delete from public.homepage_features where guide_id in ${ids};
    delete from public.guide_versions where guide_id in ${ids};
    update public.guide_ai_drafts set guide_id = null where guide_id in ${ids};
    delete from public.guide_photos where guide_id in ${ids};
    delete from public.guides where id in ${ids};
    set session_replication_role = origin;
    update public.public_content_versions set version = version + 1, changed_at = now() where scope = 'guides';`;
}
