import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  css: ["~/assets/css/main.css", "lenis/dist/lenis.css"],

  nuxtZod: {
    zodVersion: "v4",
  },

  vite: {
    plugins: [tailwindcss()],
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
    "@nuxt/fonts",
    "@nuxt/icon",
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
    "nuxt-lucide-icons",
    // 'nuxt-mail',
    // 'nuxt-resend',
    "nuxt-swiper",
    "nuxt-toast",
    "nuxt-zod",
    "shadcn-nuxt",
  ],
});
