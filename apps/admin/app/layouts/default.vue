<script setup lang="ts">
// The menu follows the role (docs/design/admin-roles.md): support doesn't
// see the owner's pages (`owner`), which also send them away if opened.
const allSections = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: "lucide:layout-dashboard" },
      { to: "/reports", label: "Problem reports", icon: "lucide:life-buoy" },
      { to: "/requests", label: "Requests", icon: "lucide:inbox" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { to: "/providers", label: "Providers", icon: "lucide:store" },
      { to: "/listings/services", label: "Services", icon: "lucide:wrench" },
      { to: "/listings/experiences", label: "Experiences", icon: "lucide:compass" },
      { to: "/categories", label: "Categories", icon: "lucide:tags", owner: true },
      { to: "/cities", label: "Markets and areas", icon: "lucide:map-pin", owner: true },
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
    items: [
      { to: "/content", label: "Destination guides", icon: "lucide:map", owner: true },
      { to: "/content/homepage", label: "Homepage", icon: "lucide:house", owner: true },
      { to: "/content/reviews", label: "Reviews", icon: "lucide:star" },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/team", label: "Team", icon: "lucide:users", owner: true },
      { to: "/settings", label: "Settings", icon: "lucide:settings", owner: true },
    ],
  },
  {
    label: "Your account",
    items: [{ to: "/security", label: "Second factor", icon: "lucide:shield-check" }],
  },
];
const role = useAdminRole();
const sections = computed(() => allSections
  .map((section) => ({ ...section, items: section.items.filter((item) => !("owner" in item) || role.value === "owner") }))
  .filter((section) => section.items.length));

const supabase = useSupabaseClient();
// The top bar stays put, so a jump to a heading stops below it.
useHead({ htmlAttrs: { class: "scroll-pt-16" } });
const user = useSupabaseUser();

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/login");
}
// A page can ask for a plain white background (the guide editor, so the
// writing area is one white page): definePageMeta({ whiteBackground: true }).
const route = useRoute();
</script>

<template>
  <div class="flex min-h-screen" :class="route.meta.whiteBackground ? 'bg-background' : 'bg-muted'">
    <!-- The sidebar and the top bar stay put while the page scrolls (2026-10-17);
         the email and "Sign out" stay at the bottom of the screen. -->
    <aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start border-r border-border bg-card md:flex">
      <div class="px-5 py-5 text-sm font-semibold tracking-tight">lokl Admin</div>
      <!-- The menu scrolls inside the sidebar if it's taller than the screen. -->
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
        <!-- "/" prefixes every route, so Dashboard only highlights on an exact match. -->
        <DashboardNav :sections="sections" exact-root="/" />
      </div>
      <div class="shrink-0 border-t border-border px-5 py-4 text-sm">
        <p class="truncate text-muted-foreground">{{ user?.email }}</p>
        <button type="button" class="mt-1 font-medium" @click="signOut">Sign out</button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- The menu on phones (the sidebar is hidden there); the bell on every size. -->
      <header class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-2 md:justify-end md:px-8">
        <div class="flex flex-1 items-center gap-2 md:hidden">
          <DashboardMobileMenu title="lokl Admin" :sections="sections" exact-root="/" :email="user?.email" @sign-out="signOut" />
          <span class="text-sm font-semibold tracking-tight">lokl Admin</span>
        </div>
        <ClientOnly><AdminNotificationBell /></ClientOnly>
      </header>
      <main class="min-w-0 flex-1 p-4 md:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
