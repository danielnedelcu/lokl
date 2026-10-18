import { analyticsPageLocation, pageViewEvent } from "@repo/types";

// Page views for Google Analytics (decided 2026-10-17): sent by lokl, not
// by Google's script (send_page_view is off), once each page has finished,
// with its address cleaned to the path and the search settings. Sign-in,
// account and dashboard pages are never measured. useAnalytics() decides
// whether anything is sent at all.
export default defineNuxtPlugin((nuxtApp) => {
  const { send } = useAnalytics();
  const router = useRouter();
  nuxtApp.hook("page:finish", () => {
    const route = router.currentRoute.value;
    const location = analyticsPageLocation(window.location.origin, route.path, route.query as Record<string, unknown>);
    if (!location) return;
    // The page's title is set as it renders: read it once the page is drawn.
    requestAnimationFrame(() => send(pageViewEvent(location, document.title)));
  });
});
