<script setup lang="ts">
// The host card: the right-hand column of the homepage's "On lokl now"
// (2026-10-11), on the hosts' orange with white text. On tablets and phones
// it comes after the listings, full width.
// "Get started" goes to the dashboard (StartHostingButton).
// A white link (docs/frontend.md, Links): white on the orange, no border,
// at the bottom of the card on wide screens.
const button = "link-white mt-6 self-start lg:mt-auto";
</script>

<template>
  <div class="bg-hosts text-hosts-foreground flex flex-col rounded-xl p-6 md:p-8">
    <p class="text-sm font-bold tracking-wide uppercase">For hosts</p>
    <h3 class="mt-3 text-2xl font-bold tracking-tight">Offer your Services or host Experiences</h3>
    <p class="mt-3">
      No upfront fees. Set your price, choose where you work, and get paid through Stripe. lokl only takes a
      commission when you're booked.
    </p>
    <StartHostingButton label="Get started" :class="button" />
  </div>
</template>
