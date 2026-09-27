// Internal owner dashboard. Never indexed, never server-rendered for SEO.
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Shared UI layer: ui-thing components, theme, Tailwind (docs/frontend.md).
  extends: ["@repo/ui"],

  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  // Admin is an authenticated tool, so SSR adds nothing but complexity.
  ssr: false,

  // Fixed port, clear of The Reserve (3000, falling back to 3001).
  devServer: {
    port: 3101,
  },

  app: {
    head: {
      title: "Admin",
      meta: [{ name: "robots", content: "noindex, nofollow" }],
    },
  },

  modules: ["@nuxt/eslint", "@nuxtjs/supabase"],

  supabase: {
    // Point this at packages/types/src/database.ts once it holds generated types.
    types: false,
    redirectOptions: {
      login: "/login",
      callback: "/confirm",
      exclude: [],
      saveRedirectToCookie: true,
    },
  },
});
