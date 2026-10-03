// CORS for the website's admin routes (/api/admin/*), which the admin app
// calls from another address (decision 14). Only the admin app's exact
// origin is allowed, without credentials: no cookies cross, the admin's
// token is sent explicitly. Any other origin gets no CORS allowance, so its
// browser won't send the request; the routes also refuse it themselves
// (requireAdminRequest).
export default defineEventHandler((event) => {
  if (!event.path.startsWith("/api/admin/")) return;
  const origin = getHeader(event, "origin");
  const allowed = useRuntimeConfig().adminOrigin;
  setResponseHeader(event, "Vary", "Origin");
  if (origin && allowed && origin === allowed) {
    setResponseHeaders(event, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    });
  }
  if (event.method === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }
});
