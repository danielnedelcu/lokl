<script setup lang="ts">
import { ADMIN_BOOKING_FIELDS, payoutState, whenOf, type AdminBookingRow } from "~/utils/bookingAdmin";

// A listing's bookings, on the admin's listing page (docs/design/
// booking-and-checkout.md, Admin). Confirmed bookings stay valid when a
// listing comes down, unless lokl cancels them (decision 13); each links to
// its booking page, where that's done.
const props = defineProps<{ listingId: string }>();
const supabase = useSupabaseClient();
const { data, error } = await useAsyncData(`admin-listing-bookings-${props.listingId}`, async () => {
  const { data, error } = await supabase.from("bookings").select(ADMIN_BOOKING_FIELDS)
    .eq("listing_id", props.listingId).neq("status", "pending_payment").order("starts_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as AdminBookingRow[];
});
watch(error, (e) => e && reportProblem("Couldn't load the listing's bookings", e), { immediate: true });
const upcoming = computed(() => (data.value ?? []).filter((b) => b.status === "confirmed" || b.status === "requested").length);
</script>

<template>
  <UiCard>
    <UiCardHeader>
      <UiCardTitle as="h2">Bookings ({{ data?.length ?? 0 }})</UiCardTitle>
      <UiCardDescription v-if="upcoming">{{ upcoming }} confirmed or waiting for an answer.</UiCardDescription>
    </UiCardHeader>
    <UiCardContent class="text-sm">
      <p v-if="error" class="text-destructive">Couldn't load the bookings. {{ loadFailedHint }}</p>
      <p v-else-if="!data?.length" class="text-muted-foreground">No bookings yet.</p>
      <ul v-else class="space-y-1">
        <li v-for="b in data" :key="b.id" class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="`/bookings/${b.id}`" class="underline underline-offset-4">{{ whenOf(b) }}</NuxtLink>
          <StatusBadge kind="adminBooking" :status="b.status" />
          <span class="text-muted-foreground">{{ b.customer_name }} · {{ payoutState(b) }}</span>
        </li>
      </ul>
    </UiCardContent>
  </UiCard>
</template>
