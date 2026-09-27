// Website-wide defaults for the shared UI layer.
export default defineAppConfig({
  // Buttons are at least 44px tall on the website (docs/frontend.md: touch
  // targets). Pass size="sm" etc. only where a smaller button is justified.
  uiButton: { defaultSize: "touch" },
});
