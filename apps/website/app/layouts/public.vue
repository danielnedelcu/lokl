<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
// Customer-facing pages: listing, browse, market. A plain header and footer;
// the homepage keeps its own markup (app/pages/index.vue).
const user = useSupabaseUser();
// "Dashboard" only for providers; every signed-in visitor has "My bookings"
// and "Saved".
// Only when signed in: /api/provider is for signed-in users.
const { data: provider } = await useOwnProvider();
const signIn = useSignIn();

// The search bar sits in the header's row from 1024px, on its own row on
// tablets; phones get one Search button. Shown and hidden with CSS, so the
// server's page matches; a hidden one ignores open requests.
const header = useTemplateRef<HTMLElement>("header");
useResizeObserver(header, (entries) => {
  document.documentElement.style.setProperty("--header-height", `${Math.ceil(entries[0]!.borderBoxSize[0]!.blockSize)}px`);
});
onBeforeUnmount(() => document.documentElement.style.removeProperty("--header-height"));

// Signing out stays on public pages; signed-in pages go home, since they'd
// only send you to sign in again.
const supabase = useSupabaseClient();
const route = useRoute();
async function signOut() {
  await supabase.auth.signOut();
  clearNuxtData("provider");
  if (route.path.startsWith("/account") || route.path.startsWith("/dashboard")) return navigateTo("/");
  await refreshNuxtData();
}
</script>

<template>
  <div class="bg-background text-foreground flex min-h-screen flex-col">
    <!-- Sticky (2026-10-12): its height is kept in --header-height, which
         html's scroll-padding-top uses, so a focused element is never hidden
         under it (WCAG 2.4.11). The search: inline from 1024px; below, on a
         row of its own (the bar on tablets, one Search button on phones). -->
    <header ref="header" class="bg-background sticky top-0 z-40 py-6">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
        <!-- The logo (2026-10-11): "hi" in an orange bubble, then "lokl".
             The link is named by the image's alt text. -->
        <NuxtLink to="/" class="focus-visible:ring-ring shrink-0 rounded-md outline-none focus-visible:ring-2">
          <img src="/hilokl-logo.svg" alt="lokl" width="200" height="76" class="h-6 w-auto max-[359px]:h-5 sm:h-8">
        </NuxtLink>
        <SearchBar class="mx-4 hidden lg:flex" />
        <!-- The menu: tertiary links, no border (docs/frontend.md, Links). Below 360px
             wide, a little tighter (the logo, gaps, padding, 13px text), so
             it fits at 320px signed in or out. -->
        <nav aria-label="Main" class="flex items-center gap-1.5 max-[359px]:gap-1 sm:gap-2">
          <NuxtLink to="/experiences" class="link-tertiary px-3 max-[359px]:px-2 max-[359px]:text-[13px] sm:px-4">Experiences</NuxtLink>
          <NuxtLink to="/services" class="link-tertiary px-3 max-[359px]:px-2 max-[359px]:text-[13px] sm:px-4">Services</NuxtLink>
          <!-- Account menu (Reka): opens with Enter, Space or a tap; arrow keys
               move through it, Escape closes it and focus returns to the button. -->
          <UiDropdownMenu v-if="user">
            <UiDropdownMenuTrigger as-child>
              <!-- Account: the same grey circle as Sign in (2026-10-11), named
                   "Account"; the dropdown says it's a menu. -->
              <button id="account-menu" type="button" aria-label="Account"
                class="bg-muted text-foreground hover:bg-border focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
                <Icon name="lucide:circle-user-round" class="size-6" aria-hidden="true" />
              </button>
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="end" class="w-56">
              <UiDropdownMenuLabel class="text-muted-foreground truncate font-normal">{{ user.email }}</UiDropdownMenuLabel>
              <UiDropdownMenuSeparator />
              <UiDropdownMenuItem as-child class="min-h-11">
                <NuxtLink to="/account/bookings"><Icon name="lucide:calendar" class="size-4" aria-hidden="true" />My bookings</NuxtLink>
              </UiDropdownMenuItem>
              <UiDropdownMenuItem as-child class="min-h-11">
                <NuxtLink to="/account/saved"><Icon name="lucide:heart" class="size-4" aria-hidden="true" />Saved</NuxtLink>
              </UiDropdownMenuItem>
              <UiDropdownMenuItem v-if="provider" as-child class="min-h-11">
                <NuxtLink to="/dashboard"><Icon name="lucide:layout-dashboard" class="size-4" aria-hidden="true" />Dashboard</NuxtLink>
              </UiDropdownMenuItem>
              <UiDropdownMenuSeparator />
              <UiDropdownMenuItem class="min-h-11" @select="signOut">
                <Icon name="lucide:log-out" class="size-4" aria-hidden="true" />Sign out
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
          <!-- Sign in: an icon in a grey circle, no text (2026-10-11); named by
               aria-label, 44px to tap (docs/frontend.md, Links). -->
          <button v-else type="button" aria-label="Sign in" aria-haspopup="dialog"
            class="bg-muted text-foreground hover:bg-border focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            @click="signIn.open({ title: 'Sign in or sign up', focusAfter: '#account-menu', offerDashboard: true })">
            <Icon name="lucide:circle-user-round" class="size-6" aria-hidden="true" />
          </button>
        </nav>
      </div>
      <div class="mx-auto mt-2 flex max-w-6xl justify-center px-4 lg:hidden">
        <SearchBar class="hidden md:flex" />
        <div class="w-full md:hidden"><SearchPhone /></div>
      </div>
    </header>
    <main id="main" tabindex="-1" class="flex-1 outline-none">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
