<script setup lang="ts">
// For someone signed in without an admin role (an invited member setting up
// their authenticators, docs/design/admin-roles.md): their own account pages
// only, with no admin navigation, notifications or data. The middleware
// chooses it.
const supabase = useSupabaseClient();
const user = useSupabaseUser();
async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/login");
}
</script>

<template>
  <div class="bg-muted min-h-screen">
    <header class="border-border bg-card flex h-14 items-center justify-between gap-3 border-b px-4 md:px-8">
      <span class="text-sm font-semibold tracking-tight">lokl Admin</span>
      <div class="flex min-w-0 items-center gap-3 text-sm">
        <span class="text-muted-foreground truncate">{{ user?.email }}</span>
        <button type="button" class="min-h-11 font-medium" @click="signOut">Sign out</button>
      </div>
    </header>
    <main class="p-4 md:p-8">
      <slot />
    </main>
  </div>
</template>
