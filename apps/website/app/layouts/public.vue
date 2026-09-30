<script setup lang="ts">
// Customer-facing pages: listing, browse, market. A plain header and footer;
// the homepage keeps its own markup (app/pages/index.vue).
const user = useSupabaseUser();
</script>

<template>
  <div class="bg-background text-foreground flex min-h-screen flex-col">
    <header class="border-border border-b">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <NuxtLink to="/" class="text-lg font-semibold tracking-tight">lokl</NuxtLink>
        <nav aria-label="Main" class="flex items-center text-sm sm:gap-1">
          <NuxtLink to="/experiences" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">Experiences</NuxtLink>
          <NuxtLink to="/services" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">Services</NuxtLink>
          <NuxtLink :to="user ? '/dashboard' : '/login'" class="hover:bg-accent rounded-md px-2 py-2.5 sm:px-3">
            {{ user ? "Dashboard" : "Sign in" }}
          </NuxtLink>
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
