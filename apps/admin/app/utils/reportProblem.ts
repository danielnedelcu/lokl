// Admin screens show plain messages; the technical detail goes to the
// browser console instead, where it's useful for debugging and isn't shown as
// a sentence on screen. Returns the plain message, for alerts and toasts.
// (Not named reportProblem: browsers have a global reportProblem(error), which
// the type checker picked instead of this one.)
export function reportProblem(message: string, error: unknown): string {
  console.error(`[admin] ${message}`, error);
  return message;
}

// For a failed page load. The page's queries run in the browser, so the detail
// is in the browser console (and the Supabase API logs), not the app's server.
export const loadFailedHint = "Try again, or check the browser console for details.";
