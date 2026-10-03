<script setup lang="ts">
  // The one place status labels and styles are defined (docs/frontend.md).
  // Every badge shows words, never colour alone.
  const labels = {
    payouts: { not_started: "Not started", in_progress: "In progress", ready: "Ready" },
    provider: { active: "Active", suspended: "Suspended" },
    // Admin reference lists (cities, service areas, categories).
    record: { active: "Active", inactive: "Inactive" },
    // Listings: plain words, not the database's status names.
    listing: {
      draft: "Draft",
      submitted: "In review",
      live: "Live",
      rejected: "Needs changes",
      unpublished: "Taken down",
    },
    // Destination guides (guideState() in @repo/types).
    guide: { draft: "Draft", published: "Published", changes: "Changes not published", unpublished: "Unpublished" },
    // Experience sessions.
    session: { scheduled: "Scheduled", cancelled: "Cancelled" },
    // Bookings, as the customer sees them.
    booking: {
      pending_payment: "Waiting for payment",
      requested: "Waiting for the provider",
      confirmed: "Confirmed",
      declined: "Declined",
      expired: "Didn't go through",
      cancelled: "Cancelled",
      completed: "Done",
      paid_out: "Done",
    },
    // Bookings, as the admin sees them.
    adminBooking: {
      pending_payment: "In checkout",
      requested: "Waiting for provider",
      confirmed: "Confirmed",
      declined: "Declined",
      expired: "Ended",
      cancelled: "Cancelled",
      completed: "Happened",
      paid_out: "Paid out",
    },
    // Bookings, as the provider sees them.
    providerBooking: {
      requested: "Needs your answer",
      confirmed: "Confirmed",
      declined: "Declined",
      expired: "Ended",
      cancelled: "Cancelled",
      completed: "Done",
      paid_out: "Paid out",
    },
  } as const;

  type Kind = keyof typeof labels;

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

  const label = computed(
    () => (labels[props.kind] as Record<string, string>)[props.status] ?? props.status,
  );
  const variant = computed(() => variants[`${props.kind}:${props.status}`] ?? "outline");
</script>

<template>
  <UiBadge :variant="variant">{{ label }}</UiBadge>
</template>
