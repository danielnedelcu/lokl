<script setup lang="ts">
const items = [
  { to: "/dashboard", label: "Overview", icon: "lucide:layout-dashboard" },
  { to: "/dashboard/services", label: "My services", icon: "lucide:wrench" },
  { to: "/dashboard/experiences", label: "My experiences", icon: "lucide:compass" },
  { to: "/dashboard/bookings", label: "Bookings", icon: "lucide:calendar" },
  { to: "/dashboard/payouts", label: "Payouts", icon: "lucide:wallet" },
  { to: "/dashboard/settings", label: "Business profile", icon: "lucide:settings" },
];

// "/dashboard" prefixes every route here, so Overview only highlights on an exact match.
const activeClass = "bg-zinc-100 font-medium !text-zinc-900";

const supabase = useSupabaseClient();
const user = useSupabaseUser();

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/");
}
</script>

<template>
  <div class="flex min-h-screen bg-zinc-50 text-zinc-900">
    <aside class="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
      <NuxtLink to="/" class="px-5 py-5 text-sm font-semibold tracking-tight">Home</NuxtLink>
      <nav class="space-y-0.5 px-3">
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          :active-class="item.to === '/dashboard' ? '' : activeClass"
          :exact-active-class="activeClass"
        >
          <Icon :name="item.icon" class="size-4" />
          {{ item.label }}
        </NuxtLink>
      </nav>
      <div class="mt-auto border-t border-zinc-200 px-5 py-4 text-sm">
        <p class="truncate text-zinc-500">{{ user?.email }}</p>
        <button type="button" class="mt-1 font-medium hover:underline" @click="signOut">Sign out</button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 p-4 md:p-8">
      <slot />
    </main>
  </div>
</template>
