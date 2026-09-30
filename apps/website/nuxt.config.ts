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

  // Sitemap: the public pages, from a server route that reads as a signed-out
  // visitor. Signed-in and sign-in pages stay out.
  sitemap: {
    sources: ["/api/__sitemap__/urls"],
    exclude: ["/dashboard/**", "/login", "/confirm"],
  },

  supabase: {
    // Auth cookies. The module's default forces Secure, which Safari refuses on
    // http://localhost (Chrome allows it), so the sign-in link's one-time code
    // verifier was never saved and every Safari sign-in failed. Secure in
    // production builds only; development runs on plain http. SameSite stays
    // "lax": arriving from the emailed link is a top-level visit, which lax
    // allows. Override at runtime with NUXT_PUBLIC_SUPABASE_COOKIE_OPTIONS_SECURE.
    cookieOptions: {
      maxAge: 60 * 60 * 8,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
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
    // Public data (docs/design/browse-and-listing-pages.md, Caching). Browse
    // and market data refresh within a minute; a listing's own data isn't
    // cached, so a listing taken down disappears from its page at once.
    // Temporary (302) while Atlanta is the only market; a market picker
    // replaces them when there's a second (docs/design/browse-and-listing-pages.md).
    // Exact paths only: /experiences/<slug> listing pages aren't redirected.
    "/experiences": { redirect: { to: "/atlanta/experiences", statusCode: 302 } },
    "/services": { redirect: { to: "/atlanta/services", statusCode: 302 } },
    "/api/public/browse": { swr: 60 },
    "/api/public/markets/**": { swr: 60 },
    "/dashboard/**": { robots: false },
    "/login": { robots: false },
    "/confirm": { robots: false },
  },

  modules: [
    "@nuxt/eslint",
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
