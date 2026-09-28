// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Shared UI layer: ui-thing components, theme, Tailwind (docs/frontend.md).
  extends: ["@repo/ui"],

  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  css: ["lenis/dist/lenis.css"],

  nuxtZod: {
    zodVersion: "v4",
  },

  // Fixed port, clear of The Reserve (3000, falling back to 3001).
  devServer: {
    port: 3100,
  },

  runtimeConfig: {
    // Server only. Set via NUXT_STRIPE_SECRET_KEY / NUXT_STRIPE_WEBHOOK_SECRET.
    stripeSecretKey: "",
    stripeWebhookSecret: "",
    public: {
      // NUXT_PUBLIC_STRIPE_KEY / NUXT_PUBLIC_SITE_URL
      stripeKey: "",
      siteUrl: "http://localhost:3100",
    },
  },

  // @nuxtjs/seo: fills the "%siteName" in page titles ("Sign in | lokl").
  // The site URL comes from NUXT_PUBLIC_SITE_URL.
  site: {
    name: "lokl",
  },

  supabase: {
    // Point this at packages/types/src/database.ts once it holds generated types.
    types: false,
    // Public pages stay open; only the provider dashboard requires sign-in.
    redirectOptions: {
      login: "/login",
      callback: "/confirm",
      include: ["/dashboard*"],
      saveRedirectToCookie: true,
    },
  },

  routeRules: {
    "/dashboard/**": { robots: false },
    "/login": { robots: false },
    "/confirm": { robots: false },
  },

  modules: [
    "@nuxt/eslint",
    "@nuxt/image",
    "@nuxt/scripts",
    "@nuxt/test-utils",
    // '@nuxtjs/sanity',
    "@nuxtjs/seo",
    "@nuxtjs/supabase",
    "dayjs-nuxt",
    "lenis/nuxt",
    "nuxt-gtag",
    "nuxt-locomotive-scroll",
    // 'nuxt-mail',
    // 'nuxt-resend',
    "nuxt-swiper",
    "nuxt-zod",
  ],
});
