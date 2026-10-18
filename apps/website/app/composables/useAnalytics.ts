import type { AnalyticsEvent } from "@repo/types";

// Google Analytics, through nuxt-gtag in manual mode (decided 2026-10-17;
// docs/decisions.md). This is the one gate: nothing reaches Google unless
// all of these hold, checked at each send:
// - an id is set (NUXT_PUBLIC_GTAG_ID, in production only, never staging);
// - a production build (never local development);
// - the page is on the site's own address, and that isn't localhost (the
//   end-to-end tests' analytics server is the one exception, where every
//   request to Google is caught and answered locally);
// - the browser doesn't send Global Privacy Control.
// Only then is Google's script loaded (initialize) and the event sent. An
// event is never queued while analytics is off: nuxt-gtag's dataLayer would
// send anything queued once the script loaded.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function useAnalytics() {
  const config = useRuntimeConfig().public;

  function allowed(): boolean {
    if (!import.meta.client || import.meta.dev) return false;
    const id = (config.gtag as { id?: string } | undefined)?.id;
    if (!id) return false;
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return false;
    let site: URL;
    try {
      site = new URL(config.siteUrl);
    } catch {
      return false;
    }
    if (window.location.origin !== site.origin) return false;
    // Nuxt reads the setting "1" from the environment as the number 1.
    if (LOCAL.test(window.location.hostname) && String(config.analyticsAllowLocal) !== "1") return false;
    return true;
  }

  /** Sends one event built in @repo/types (analytics.ts), if analytics may run. */
  function send(event: AnalyticsEvent) {
    if (!allowed()) return;
    const { gtag, initialize } = useGtag();
    initialize();
    // A beacon, so an event sent just before leaving for Stripe still goes.
    gtag("event", event.name, { ...event.params, transport_type: "beacon" });
  }

  return { send, origin: () => (import.meta.client ? window.location.origin : "") };
}
