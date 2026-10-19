// https://nuxt.com/docs/api/configuration/nuxt-config
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// `npm run build:check` (LOKL_BUILD_CHECK=1) builds into its own folders, so
// a build check never touches the .nuxt, .output or Vite cache that a running
// dev server uses (a plain `nuxt build` in the app folder can break it).
// `npm run build:secrets-check` (LOKL_BUILD_CHECK=secrets) uses folders of
// its own again (-secrets), so it never replaces the build the tests run.
const buildCheck = process.env.LOKL_BUILD_CHECK;
const buildSet = buildCheck === "secrets" ? "secrets" : "check";
const buildCheckFolders = buildCheck === "1" || buildCheck === "secrets"
  ? { buildDir: `.nuxt-${buildSet}`, nitro: { output: { dir: `.output-${buildSet}` } }, vite: { cacheDir: `node_modules/.cache/vite-${buildSet}` } }
  : {};

// See `hooks` below: the OG image secret, kept out of module setup.
let hiddenOgSecret: string | undefined;

/** /help/<slug> for every Help centre article (docs/design/website-pages.md). */
function helpArticleUrls(): string[] {
  const dir = fileURLToPath(new URL("./content/help", import.meta.url));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".md"))
    .map((f) => `/help/${f.split("/").pop()!.replace(/\.md$/, "")}`);
}

export default defineNuxtConfig({
  ...buildCheckFolders,
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
    // Server only. Set via NUXT_STRIPE_SECRET_KEY / NUXT_STRIPE_WEBHOOK_SECRET
    // (connected-account events) / NUXT_STRIPE_PAYMENTS_WEBHOOK_SECRET (booking
    // payments, events on lokl's own account).
    stripeSecretKey: "",
    stripeWebhookSecret: "",
    stripePaymentsWebhookSecret: "",
    // NUXT_JOB_SECRET: the timed jobs' shared secret (/api/jobs/*). Empty
    // means the job routes refuse every call.
    jobSecret: "",
    // Booking emails (server/utils/bookingEmails.ts), all server only:
    // NUXT_RESEND_API_KEY (its own Resend key, not the one Supabase uses for
    // sign-in emails), NUXT_EMAIL_MODE (off | allowlist | send),
    // NUXT_EMAIL_ALLOWLIST (comma-separated, for allowlist mode),
    // NUXT_EMAIL_REPLY_TO (required to send), NUXT_EMAIL_FROM.
    // NUXT_ADMIN_ORIGIN: the admin app's exact address, the only origin
    // allowed to call /api/admin/* (decision 14). Empty refuses every call.
    adminOrigin: "",
    resendApiKey: "",
    emailMode: "off",
    emailAllowlist: "",
    emailReplyTo: "",
    emailFrom: "lokl <lokl@innatetheory.com>",
    public: {
      // NUXT_PUBLIC_STRIPE_KEY / NUXT_PUBLIC_SITE_URL
      stripeKey: "",
      siteUrl: "http://localhost:3100",
      // Google Analytics on localhost: for the end-to-end tests' analytics
      // server only, where every request to Google is caught and answered
      // locally (scripts/ci-start-apps.mjs; e2e journey 35). Never set it
      // anywhere else. NUXT_PUBLIC_ANALYTICS_ALLOW_LOCAL.
      analyticsAllowLocal: "",
      // NUXT_PUBLIC_SUPPORT_EMAIL: where providers and customers can write
      // to lokl (the same address booking emails reply to, for now).
      supportEmail: "",
      // NUXT_PUBLIC_GOOGLE_CLIENT_ID: the Google sign-in client (a public
      // value). Empty: no "Continue with Google" (GoogleSignIn).
      googleClientId: "",
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
    // The Help centre's articles (content/help/<audience>/<slug>.md), read when building.
    urls: helpArticleUrls(),
    exclude: ["/dashboard/**", "/login", "/confirm"],
  },

  supabase: {
    // The server key is read only at runtime (NUXT_SUPABASE_SECRET_KEY). The
    // module's own defaults read it from the environment while building,
    // which baked the hosted project's key into the server output (found
    // 2026-10-09); these literal empty values replace those defaults, and the
    // build check (npm run build:secrets-check) fails if one comes back.
    secretKey: "",
    serviceKey: "",
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
    // Generated by `npm run db:types` from the linked project; every query
    // is typed against the real schema. An absolute path: the module resolves
    // relative paths and aliases from its own folder.
    types: fileURLToPath(new URL("../../packages/types/src/database.ts", import.meta.url)),
    // Public pages stay open; the provider dashboard and the customer's
    // account pages require sign-in.
    redirectOptions: {
      login: "/login",
      callback: "/confirm",
      // Providers' dashboard, and customers' own bookings.
      include: ["/dashboard*", "/account*"],
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
    //
    // The public routes' cache is in server/utils/publicCache.ts (2026-10-18):
    // 60 seconds per address, answered fresh at once when the content behind
    // it changes (the database's content versions), never at the edge.
    "/dashboard/**": { robots: false },
    "/account/**": { robots: false },
    "/login": { robots: false },
    "/confirm": { robots: false },
  },

  // nuxt-og-image (part of @nuxtjs/seo) reads NUXT_OG_IMAGE_SECRET from the
  // environment while it sets up, and bakes it into the build (found
  // 2026-10-09). An empty `security.secret` doesn't stop that (it falls back
  // to the environment), so the variable is hidden while modules set up and
  // put back after, for the dev server. Built apps read it at runtime
  // (runtimeConfig.ogImage.secret, from NUXT_OG_IMAGE_SECRET); the build
  // check (npm run build:secrets-check) fails if it's baked in again.
  hooks: {
    "modules:before": () => {
      hiddenOgSecret = process.env.NUXT_OG_IMAGE_SECRET;
      delete process.env.NUXT_OG_IMAGE_SECRET;
    },
    "modules:done": () => {
      if (hiddenOgSecret !== undefined) process.env.NUXT_OG_IMAGE_SECRET = hiddenOgSecret;
    },
  },

  // Google Analytics 4, measurement only (decided 2026-10-17;
  // docs/decisions.md). Nothing loads until useAnalytics() starts it: an id
  // set (NUXT_PUBLIC_GTAG_ID, in production only), a production build, the
  // site's own address, and no Global Privacy Control. Events are built in
  // @repo/types (analytics.ts), never sent automatically.
  gtag: {
    id: "",
    initMode: "manual",
    // Consent Mode: no advertising storage or signals, ever.
    initCommands: [["consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" }]],
    config: {
      // lokl sends cleaned page views itself, only for public pages.
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // About 2 months, as long as the data is kept (not Google's 2 years).
      cookie_expires: 60 * 60 * 24 * 61,
    },
  },

  modules: [
    "@nuxt/eslint",
    "@nuxt/test-utils",
    // '@nuxtjs/sanity',
    "@nuxtjs/seo",
    "@nuxtjs/supabase",
    "dayjs-nuxt",
    "lenis/nuxt",
    "nuxt-gtag",
    "nuxt-swiper",
    "nuxt-zod",
  ],
});
