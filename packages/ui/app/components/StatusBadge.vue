<script setup lang="ts">
  import type { StatusKind } from "../utils/statusLabels";
  // The one place status labels and styles are defined (docs/frontend.md).
  // Every badge shows words, never colour alone.
  // The labels live in utils/statusLabels.ts, so searches can match the same words.

  type Kind = StatusKind;

  const props = defineProps<{ kind: Kind; status: string }>();

  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    "payouts:ready": "default",
    "payouts:in_progress": "secondary",
    "payouts:not_started": "outline",
    "provider:active": "outline",
    "provider:suspended": "destructive",
    "record:active": "outline",
    "record:inactive": "secondary",
    "listing:draft": "outline",
    "listing:submitted": "secondary",
    "listing:live": "default",
    "listing:rejected": "destructive",
    "listing:unpublished": "secondary",
    "guide:draft": "outline",
    "guide:published": "default",
    "guide:changes": "secondary",
    "guide:unpublished": "secondary",
    "session:scheduled": "outline",
    "session:cancelled": "secondary",
    "booking:pending_payment": "outline",
    "booking:requested": "secondary",
    "booking:confirmed": "default",
    "booking:declined": "destructive",
    "booking:expired": "outline",
    "booking:cancelled": "outline",
    "booking:completed": "outline",
    "booking:paid_out": "outline",
    "adminBooking:requested": "secondary",
    "adminBooking:confirmed": "default",
    "adminBooking:declined": "destructive",
    "providerBooking:requested": "default",
    "providerBooking:confirmed": "secondary",
  };

  const label = computed(() => statusLabel(props.kind, props.status));
  const variant = computed(() => variants[`${props.kind}:${props.status}`] ?? "outline");
</script>

<template>
  <UiBadge :variant="variant">{{ label }}</UiBadge>
</template>
