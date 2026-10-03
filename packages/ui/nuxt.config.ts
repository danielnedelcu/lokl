import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

// Paths in a layer resolve against the layer's own folder. "~" would point at
// the app extending it instead (ui-thing init adds a "~/" entry; don't keep it).
const layerDir = fileURLToPath(new URL("./", import.meta.url));

// Shared UI layer: ui-thing components, shared lokl components and the theme.
// Both apps extend it (`extends: ["@repo/ui"]`). See docs/frontend.md.
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  css: [`${layerDir}app/assets/css/tailwind.css`],

  vite: {
    plugins: [tailwindcss()],
  },

  modules: [
    "@nuxtjs/color-mode",
    "motion-v/nuxt",
    "@vueuse/nuxt",
    "@nuxt/icon",
    "@nuxt/fonts",
    "vue-sonner/nuxt",
    "@vee-validate/nuxt",
    "@nuxt/image",
  ],

  imports: {
    imports: [{
      from: "tailwind-variants",
      name: "tv",
    }, {
      from: "tailwind-variants",
      name: "VariantProps",
      type: true,
    }, {
      from: "vue-sonner",
      name: "toast",
      as: "useSonner",
    }],
  },

  // Light mode only at launch (docs/frontend.md). Without this, color-mode
  // follows the visitor's system setting and would switch to dark.
  // Forms validate zod 4 schemas through app/utils/zodSchema.ts, so the module
  // shouldn't look for a schema adapter package (it warns about zod/valibot).
  veeValidate: {
    typedSchemaPackage: "none",
  },

  // Listing and guide photos render with <NuxtImg> (docs/frontend.md). The
  // "none" provider passes URLs through unchanged until image sizes and a
  // provider are chosen (docs/TODO.md, browse pages step); switching this
  // setting then resizes every photo without touching components.
  image: {
    provider: "none",
  },

  // Roboto, served from our own site: @nuxt/fonts downloads the files from
  // Google when the app builds (or the dev server starts) and serves them
  // under /_fonts, so visitors' browsers never contact Google. Only the
  // weights the apps use; italic faces are declared too, because guide text
  // can be italic, but a browser downloads a face only when a page uses it.
  // Latin subsets only. font-display is swap (the module's default), and
  // it adds "Roboto Fallback", a local Arial resized to Roboto's measurements,
  // so text doesn't jump when Roboto arrives. Used through --font-sans in
  // app/assets/css/tailwind.css (docs/frontend.md, Theme).
  fonts: {
    provider: "google",
    families: [{
      name: "Roboto",
      weights: [400, 500, 700],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
    }],
  },

  colorMode: {
    preference: "light",
    fallback: "light",
    storageKey: "ui-color-mode",
    classSuffix: "",
  },

  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 0,
    },

    mode: "svg",
    class: "shrink-0",
    fetchTimeout: 2000,
    serverBundle: "local",
  },
});