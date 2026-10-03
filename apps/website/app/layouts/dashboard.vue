<script setup lang="ts">
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const { data: provider } = await useProvider();

// A provider's links; someone with no business yet (often a customer) gets
// the setup page and their own bookings instead (found 2026-10-03).
const sections = computed(() => [{ items: provider.value
  ? [
      { to: "/dashboard", label: "Overview", icon: "lucide:layout-dashboard" },
      { to: "/dashboard/services", label: "My services", icon: "lucide:wrench" },
      { to: "/dashboard/experiences", label: "My experiences", icon: "lucide:compass" },
      { to: "/dashboard/bookings", label: "Bookings", icon: "lucide:calendar" },
      { to: "/dashboard/payouts", label: "Payouts", icon: "lucide:wallet" },
      { to: "/dashboard/settings", label: "Business profile", icon: "lucide:settings" },
    ]
  : [
      { to: "/dashboard", label: "Overview", icon: "lucide:layout-dashboard" },
      { to: "/dashboard/settings", label: "Set up your business", icon: "lucide:store" },
      { to: "/account/bookings", label: "My bookings", icon: "lucide:calendar" },
    ] }]);
const supportEmail = useRuntimeConfig().public.supportEmail;

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/");
}
</script>

<template>
  <div class="flex min-h-screen bg-muted text-foreground">
    <aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <NuxtLink to="/" class="px-5 py-5 text-sm font-semibold tracking-tight">Home</NuxtLink>
      <div class="px-3">
        <!-- "/dashboard" prefixes every route here, so Overview only highlights on an exact match. -->
        <DashboardNav :sections="sections" exact-root="/dashboard" />
      </div>
      <div class="mt-auto border-t border-border px-5 py-4 text-sm">
        <p class="truncate text-muted-foreground">{{ user?.email }}</p>
        <button type="button" class="mt-1 font-medium" @click="signOut">Sign out</button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Top bar: the phone menu on the left (hidden from md up), notifications on the right. -->
      <header class="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-2 md:justify-end md:px-8">
        <DashboardMobileMenu title="lokl" :sections="sections" exact-root="/dashboard" :email="user?.email" @sign-out="signOut" />
        <ClientOnly>
          <NotificationBell v-if="provider" :provider-id="provider.id" :listing-path="(id) => `/dashboard/listings/${id}`" :booking-path="(id) => `/dashboard/bookings/${id}`" />
        </ClientOnly>
      </header>
      <main class="min-w-0 flex-1 p-4 md:p-8">
        <!-- While lokl has paused the account (decided 2026-10-03). They can
             still see and cancel bookings; the rest is refused. -->
        <UiAlert v-if="provider?.status === 'suspended'" variant="destructive" icon="lucide:pause-circle" class="mb-6 max-w-3xl">
          <UiAlertTitle as="h2">Your account is paused</UiAlertTitle>
          <UiAlertDescription>
            Your listings are hidden, so customers can't find or book them. Requests you hadn't answered have been
            withdrawn, and your payouts are on hold. Bookings that were already confirmed still go ahead.
            <template v-if="supportEmail">Questions? Email <a :href="`mailto:${supportEmail}`" class="font-medium">{{ supportEmail }}</a>.</template>
            <template v-else>Questions? Reply to the email we sent you.</template>
          </UiAlertDescription>
        </UiAlert>
        <slot />
      </main>
    </div>
  </div>
</template>
