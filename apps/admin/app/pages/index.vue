<script setup lang="ts">
// Placeholder metrics until Supabase + Stripe data is wired in.
const kpis = [
  { label: "GMV (30 days)", value: "—", hint: "Total booking value" },
  { label: "Commission revenue", value: "—", hint: "Platform fees collected" },
  { label: "Bookings", value: "—", hint: "Completed in the last 30 days" },
  { label: "Active providers", value: "—", hint: "At least one booking in 90 days" },
];

const queues = [
  { to: "/providers", label: "Providers awaiting approval", icon: "lucide:store" },
  { to: "/listings/experiences", label: "Experiences awaiting review", icon: "lucide:compass" },
  { to: "/disputes", label: "Open disputes", icon: "lucide:shield-alert" },
  { to: "/content", label: "Guide drafts", icon: "lucide:file-pen" },
];
</script>

<template>
  <div>
    <PageHeader title="Dashboard" description="Marketplace health at a glance." />

    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="kpi in kpis" :key="kpi.label" class="rounded-lg border border-border bg-surface p-4">
        <p class="text-sm text-ink-muted">{{ kpi.label }}</p>
        <p class="mt-2 text-2xl font-semibold">{{ kpi.value }}</p>
        <p class="mt-1 text-xs text-ink-muted">{{ kpi.hint }}</p>
      </div>
    </section>

    <h2 class="mt-10 mb-3 text-sm font-semibold">Needs attention</h2>
    <section class="grid gap-3 sm:grid-cols-2">
      <NuxtLink
        v-for="q in queues"
        :key="q.to"
        :to="q.to"
        class="flex items-center justify-between rounded-lg border border-border bg-surface p-4 hover:border-ink-muted"
      >
        <span class="flex items-center gap-2 text-sm">
          <Icon :name="q.icon" class="size-4 text-ink-muted" />
          {{ q.label }}
        </span>
        <span class="text-sm font-medium">—</span>
      </NuxtLink>
    </section>
  </div>
</template>
