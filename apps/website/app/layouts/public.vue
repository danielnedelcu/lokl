<script setup lang="ts">
// Customer-facing pages: listing, browse, market. A plain header and footer;
// the homepage keeps its own markup (app/pages/index.vue).
const user = useSupabaseUser();
// "Dashboard" only for providers; every signed-in visitor has "My bookings"
// and "Saved".
// Only when signed in: /api/provider is for signed-in users.
const { data: provider } = user.value ? await useProvider() : { data: ref(null) };

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
        <nav aria-label="Main" class="flex items-center text-sm sm:gap-1">
          <NuxtLink to="/experiences" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">Experiences</NuxtLink>
          <NuxtLink to="/services" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">Services</NuxtLink>
          <!-- Account menu (Reka): opens with Enter, Space or a tap; arrow keys
               move through it, Escape closes it and focus returns to the button. -->
          <UiDropdownMenu v-if="user">
            <UiDropdownMenuTrigger as-child>
              <button type="button" class="hover:bg-accent focus-visible:ring-ring flex min-h-11 items-center gap-1 rounded-md px-2 focus-visible:ring-2 focus-visible:outline-none sm:px-3">
                <Icon name="lucide:circle-user" class="size-4" aria-hidden="true" />
                Account
                <Icon name="lucide:chevron-down" class="size-3.5" aria-hidden="true" />
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
          <NuxtLink v-else to="/login" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">Sign in</NuxtLink>
        </nav>
      </div>
    </header>
    <main id="main" class="flex-1">
      <slot />
    </main>
    <footer class="border-border text-muted-foreground border-t">
      <div class="mx-auto max-w-6xl px-4 py-8 text-sm">
        <p>lokl · Services and Experiences from local people in Atlanta.</p>
      </div>
    </footer>
  </div>
</template>
