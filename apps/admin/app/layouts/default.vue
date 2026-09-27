<script setup lang="ts">
const sections = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: "lucide:layout-dashboard" }],
  },
  {
    label: "Marketplace",
    items: [
      { to: "/providers", label: "Providers", icon: "lucide:store" },
      { to: "/listings/services", label: "Services", icon: "lucide:wrench" },
      { to: "/listings/experiences", label: "Experiences", icon: "lucide:compass" },
      { to: "/categories", label: "Categories", icon: "lucide:tags" },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/bookings", label: "Bookings & payouts", icon: "lucide:receipt" },
      { to: "/disputes", label: "Disputes & refunds", icon: "lucide:shield-alert" },
    ],
  },
  {
    label: "Content",
    items: [{ to: "/content", label: "Destination guides", icon: "lucide:map" }],
  },
  {
    label: "Platform",
    items: [
      { to: "/users", label: "Users", icon: "lucide:users" },
      { to: "/settings", label: "Settings", icon: "lucide:settings" },
    ],
  },
];

// "/" prefixes every route, so Dashboard only highlights on an exact match.
const activeClass = "bg-surface-muted font-medium !text-ink";

const supabase = useSupabaseClient();
const user = useSupabaseUser();

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/login");
}
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div class="px-5 py-5 text-sm font-semibold tracking-tight">Marketplace Admin</div>
      <nav class="space-y-6 px-3 pb-6">
        <div v-for="section in sections" :key="section.label">
          <p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
            {{ section.label }}
          </p>
          <NuxtLink
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
            :active-class="item.to === '/' ? '' : activeClass"
            :exact-active-class="activeClass"
          >
            <Icon :name="item.icon" class="size-4" />
            {{ item.label }}
          </NuxtLink>
        </div>
      </nav>
      <div class="mt-auto border-t border-border px-5 py-4 text-sm">
        <p class="truncate text-ink-muted">{{ user?.email }}</p>
        <button type="button" class="mt-1 font-medium hover:underline" @click="signOut">Sign out</button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 p-4 md:p-8">
      <slot />
    </main>
  </div>
</template>
