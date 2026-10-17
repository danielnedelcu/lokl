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

// The same for a problem report (docs/design/problem-reports.md): the bells
// announce each notification's report, and an open report page reloads its
// thread through its read rules, so a reply appears without Realtime ever
// carrying the message's text.
const reportListeners = new Set<Listener>();

export function announceSupportReportChanged(reportId: string) {
  for (const listener of reportListeners) listener(reportId);
}

/** Calls `listener` whenever a problem report changes, until the calling component unmounts. */
export function onSupportReportChanged(listener: Listener) {
  reportListeners.add(listener);
  if (getCurrentScope()) onScopeDispose(() => reportListeners.delete(listener));
  return () => reportListeners.delete(listener);
}
