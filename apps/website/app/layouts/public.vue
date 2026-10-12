<script setup lang="ts">
// Customer-facing pages: listing, browse, market. A plain header and footer;
// the homepage keeps its own markup (app/pages/index.vue).
const user = useSupabaseUser();
// "Dashboard" only for providers; every signed-in visitor has "My bookings"
// and "Saved".
// Only when signed in: /api/provider is for signed-in users.
const { data: provider } = await useOwnProvider();
const signIn = useSignIn();

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
    <header class="border-border border-b">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <NuxtLink to="/" class="text-lg font-semibold tracking-tight">lokl</NuxtLink>
        <!-- The menu: tertiary links, no border (docs/frontend.md, Links). -->
        <nav aria-label="Main" class="flex items-center gap-1.5 sm:gap-2">
          <NuxtLink to="/experiences" class="link-tertiary px-3 sm:px-4">Experiences</NuxtLink>
          <NuxtLink to="/services" class="link-tertiary px-3 sm:px-4">Services</NuxtLink>
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
    </header>
    <main id="main" tabindex="-1" class="flex-1 outline-none">
      <slot />
    </main>
    <footer class="border-border text-muted-foreground border-t">
      <div class="mx-auto max-w-6xl px-4 py-8 text-sm">
        <p>lokl · Services and Experiences from local people in Atlanta.</p>
      </div>
    </footer>
  </div>
</template>
