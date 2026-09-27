<template>
  <div>
    <PageHeader title="Settings" description="Platform-wide configuration." />
    <div class="space-y-4">
      <section class="rounded-lg border border-border bg-surface p-5">
        <h2 class="font-medium">Commission rates</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Platform fee per category type, and who pays it (provider, customer, or split). Not decided yet.
        </p>
      </section>
      <section class="rounded-lg border border-border bg-surface p-5">
        <h2 class="font-medium">Stripe Connect</h2>
        <p class="mt-1 text-sm text-ink-muted">Platform account and webhook status.</p>
      </section>
    </div>
  </div>
</template>
