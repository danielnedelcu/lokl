// Keeps a page's data current when someone else can change it
// (docs/frontend.md, Data and states; docs/design/notifications.md):
//
// - refreshes when the tab becomes visible again, at most every 15 seconds;
// - refreshes straight away when a notification names a listing the page
//   shows (listings: "any" for lists of the provider's listings).
//
// It only refreshes data. A page with a form keeps unsaved changes itself:
// refresh the saved record, never reset a dirty form (see ListingEditor).

const FOCUS_REFRESH_MS = 15_000;

export function useLiveData(options: {
  refresh: () => Promise<unknown> | unknown;
  listings?: "any" | (() => (string | null | undefined)[]);
}) {
  let lastRefresh = Date.now();
  const refresh = async () => {
    lastRefresh = Date.now();
    await options.refresh();
  };

  if (import.meta.client) {
    useEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh >= FOCUS_REFRESH_MS) void refresh();
    });

    if (options.listings) {
      onListingChanged((listingId) => {
        const wanted = options.listings === "any" || (options.listings as () => (string | null | undefined)[])().includes(listingId);
        if (wanted) void refresh();
      });
    }
  }

  return { refresh };
}
