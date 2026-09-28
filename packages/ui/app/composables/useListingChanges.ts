// An in-app signal: "this listing just changed" (docs/design/notifications.md).
// The notification bell announces each arriving notification's listing;
// useLiveData() listens, so any open page showing that listing refreshes.
// Browser-only and per tab; nothing leaves the page.

type Listener = (listingId: string) => void;
const listeners = new Set<Listener>();

export function announceListingChanged(listingId: string) {
  for (const listener of listeners) listener(listingId);
}

/** Calls `listener` whenever a listing changes, until the calling component unmounts. */
export function onListingChanged(listener: Listener) {
  listeners.add(listener);
  if (getCurrentScope()) onScopeDispose(() => listeners.delete(listener));
  return () => listeners.delete(listener);
}
