<script setup lang="ts">
// The homepage's closing invitation to host (2026-10-11): a large headline
// and "Start hosting", then three reasons, on the hosts' orange with black
// text. The headline sits beside the button on wide screens and above it on
// phones; the reasons are three across, or stacked on phones. Aligned with
// the page's other sections (max-w-6xl, 16px at the sides). "Start
// hosting" goes to the dashboard, like the host card's "Get started"
// (StartHostingButton).
const REASONS = [
  { title: "No upfront fees", text: "lokl only takes a commission when you're booked." },
  { title: "Your price, your place", text: "Set your rate and choose where you work." },
  { title: "Paid through Stripe", text: "Payouts land straight in your account." },
];
</script>

<template>
  <section aria-labelledby="hosting-heading" class="mx-auto max-w-6xl px-4 pb-12">
    <div class="bg-hosts text-hosts-foreground flex flex-col gap-9 rounded-[28px] p-8 md:p-14">
      <div class="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
        <h2 id="hosting-heading" class="font-display max-w-[680px] text-5xl leading-[0.92] font-extrabold tracking-[-0.045em] md:text-7xl">
          Got a skill? Get booked.
        </h2>
        <StartHostingButton label="Start hosting"
          class="link-primary shrink-0 self-start md:self-auto" />
      </div>
      <ul class="border-hosts-ink grid gap-6 border-t-2 pt-6 md:grid-cols-3">
        <li v-for="r in REASONS" :key="r.title" class="flex flex-col gap-1.5">
          <p class="text-lg font-bold">{{ r.title }}</p>
          <p class="text-[15px] leading-normal">{{ r.text }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>
