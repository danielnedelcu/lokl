<script setup lang="ts">
  // The one place status labels and styles are defined (docs/frontend.md).
  // Every badge shows words, never colour alone.
  const labels = {
    payouts: { not_started: "Not started", in_progress: "In progress", ready: "Ready" },
    provider: { active: "Active", suspended: "Suspended" },
  } as const;

  type Kind = keyof typeof labels;

  const props = defineProps<{ kind: Kind; status: string }>();

  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    "payouts:ready": "default",
    "payouts:in_progress": "secondary",
    "payouts:not_started": "outline",
    "provider:active": "outline",
    "provider:suspended": "destructive",
  };

  const label = computed(
    () => (labels[props.kind] as Record<string, string>)[props.status] ?? props.status,
  );
  const variant = computed(() => variants[`${props.kind}:${props.status}`] ?? "outline");
</script>

<template>
  <UiBadge :variant="variant">{{ label }}</UiBadge>
</template>
