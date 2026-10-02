<script setup lang="ts">
import type { ListingKind } from "@repo/types";

// The one cancellation policy, in plain words, shown before paying and on
// every booking (docs/design/booking-and-checkout.md, decision 5, and the
// 1-hour grace period decided 2026-10-02). customerCancelOutcome() in
// @repo/types is the same policy in code.
defineProps<{ kind: ListingKind; heading?: boolean }>();
</script>

<template>
  <div class="text-sm">
    <p v-if="heading" class="mb-1 font-medium">Cancellation</p>
    <p class="text-muted-foreground">
      Free cancellation until 48 hours before. Changed your mind straight away? You can also cancel for free
      within 1 hour of booking, as long as it hasn't started. Otherwise, no refund within 48 hours. If the
      provider cancels, you always get a full refund.
      <template v-if="kind === 'service'">Your card is held, not charged, until they accept.</template>
    </p>
  </div>
</template>
