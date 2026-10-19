// Marks <html data-hydrated> once the app has hydrated (for the admin app,
// rendered client-side, once it first renders), 2026-10-19. The browser tests
// wait for it after loading a page (e2e/support/fixtures.ts), so a test acts
// once the page responds, as a person does: a click before then landed on
// server-rendered HTML and was lost. Nothing shows; nothing else reads it.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:suspense:resolve", () => {
    document.documentElement.dataset.hydrated = "";
  });
});
