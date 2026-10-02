<script setup lang="ts">
import type { ListingKind } from "@repo/types";

// The one cancellation policy, in plain words, shown before paying and on
// every booking (docs/design/booking-and-checkout.md, decision 5).
defineProps<{ kind: ListingKind; heading?: boolean }>();
</script>

<template>
  <div class="text-sm">
    <p v-if="heading" class="mb-1 font-medium">Cancellation</p>
    <p class="text-muted-foreground">
      Free cancellation until 48 hours before. After that, no refund. If the provider cancels, you always get a
      full refund.
      <template v-if="kind === 'service'">Your card is held, not charged, until they accept.</template>
    </p>
  </div>
</template>
