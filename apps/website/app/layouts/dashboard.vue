<script setup lang="ts">
const supabase = useSupabaseClient();
// The top bar stays put, so a jump to a heading stops below it.
useHead({ htmlAttrs: { class: "scroll-pt-16" } });
const user = useSupabaseUser();
const { data: provider } = await useProvider();

// Reports waiting for the provider's reply, beside "Help"; a reply from lokl
// (a notification) or coming back to the tab updates it.
const { data: waitingReports, refresh: refreshWaiting } = await useAsyncData("support-waiting", async () => {
  if (!provider.value) return 0;
  const { count } = await supabase.from("support_reports").select("id", { count: "exact", head: true }).eq("status", "waiting");
  return count ?? 0;
}, { watch: [() => provider.value?.id] });
useLiveData({ refresh: refreshWaiting });
onSupportReportChanged(() => void refreshWaiting());
const waitingLabel = (n: number) => `${n} ${n === 1 ? "report" : "reports"} waiting for your reply`;

// A provider's links; someone with no business yet (often a customer) gets
// the setup page and their own bookings instead (found 2026-10-03).
const sections = computed(() => [{ items: provider.value
  ? [
      { to: "/dashboard", label: "Overview", icon: "lucide:layout-dashboard" },
      { to: "/dashboard/services", label: "My services", icon: "lucide:wrench" },
      { to: "/dashboard/experiences", label: "My experiences", icon: "lucide:compass" },
      { to: "/dashboard/availability", label: "Availability", icon: "lucide:calendar-clock" },
      { to: "/dashboard/bookings", label: "Bookings", icon: "lucide:calendar" },
      { to: "/dashboard/reviews", label: "Reviews", icon: "lucide:star" },
      { to: "/dashboard/payouts", label: "Payouts", icon: "lucide:wallet" },
      { to: "/dashboard/settings", label: "Business profile", icon: "lucide:settings" },
      { to: "/dashboard/help", label: "Help", icon: "lucide:life-buoy", count: waitingReports.value ?? 0, countLabel: waitingLabel(waitingReports.value ?? 0) },
    ]
  : [
      { to: "/dashboard", label: "Overview", icon: "lucide:layout-dashboard" },
      { to: "/dashboard/settings", label: "Set up your business", icon: "lucide:store" },
      { to: "/account/bookings", label: "My bookings", icon: "lucide:calendar" },
      { to: "/account/saved", label: "Saved", icon: "lucide:heart" },
    ] }]);
const supportEmail = useRuntimeConfig().public.supportEmail;

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/");
}
</script>

<template>
  <div class="flex min-h-screen bg-muted text-foreground">
    <!-- The sidebar and the top bar stay put while the page scrolls (2026-10-17);
         the email and "Sign out" stay at the bottom of the screen. -->
    <aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start border-r border-border bg-card md:flex">
      <NuxtLink to="/" class="px-5 py-5 text-sm font-semibold tracking-tight">Home</NuxtLink>
      <!-- The menu scrolls inside the sidebar if it's taller than the screen
           (data-lenis-prevent: the smooth scrolling leaves it alone). -->
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3" data-lenis-prevent>
        <!-- "/dashboard" prefixes every route here, so Overview only highlights on an exact match. -->
        <DashboardNav :sections="sections" exact-root="/dashboard" />
      </div>
      <div class="shrink-0 border-t border-border px-5 py-4 text-sm">
        <p class="truncate text-muted-foreground">{{ user?.email }}</p>
        <button type="button" class="mt-1 font-medium" @click="signOut">Sign out</button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Top bar: the phone menu on the left (hidden from md up), notifications on the right. -->
      <header class="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-2 md:justify-end md:px-8">
        <DashboardMobileMenu title="lokl" :sections="sections" exact-root="/dashboard" :email="user?.email" @sign-out="signOut" />
        <ClientOnly>
          <NotificationBell v-if="provider" :provider-id="provider.id" :listing-path="(id) => `/dashboard/listings/${id}`" :booking-path="(id) => `/dashboard/bookings/${id}`" :support-path="(id) => `/dashboard/help/${id}`" />
        </ClientOnly>
      </header>
      <!-- id and tabindex: focus lands here after signing in to come here ("Get started"). -->
      <main id="main" tabindex="-1" class="min-w-0 flex-1 p-4 outline-none md:p-8">
        <!-- While lokl has paused the account (decided 2026-10-03). They can
             still see and cancel bookings; the rest is refused. -->
        <UiAlert v-if="provider?.status === 'suspended'" variant="destructive" icon="lucide:pause-circle" class="mb-6 max-w-3xl">
          <UiAlertTitle as="h2">Your account is paused</UiAlertTitle>
          <UiAlertDescription>
            Your listings are hidden, so customers can't find or book them. Requests you hadn't answered have been
            withdrawn, and your payouts are on hold. Bookings that were already confirmed still go ahead.
            <template v-if="supportEmail">Questions? Email <a :href="`mailto:${supportEmail}`" class="link-text">{{ supportEmail }}</a>.</template>
            <template v-else>Questions? Reply to the email we sent you.</template>
          </UiAlertDescription>
        </UiAlert>
        <slot />
      </main>
    </div>
  </div>
</template>
