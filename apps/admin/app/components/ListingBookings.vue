<script setup lang="ts">
import { payoutState, whenOf } from "~/utils/bookingAdmin";

// A listing's bookings, on the admin's listing page (docs/design/
// booking-and-checkout.md, Admin). Confirmed bookings stay valid when a
// listing comes down, unless lokl cancels them (decision 13); each links to
// its booking page, where that's done.
const props = defineProps<{ listingId: string }>();
const supabase = useSupabaseClient();
// The latest 200, with every booking and every upcoming one counted
// (utils/adminLists.ts).
const { data, error } = await useAsyncData(`admin-listing-bookings-${props.listingId}`, () => listingBookings(supabase, props.listingId));
watch(error, (e) => e && reportProblem("Couldn't load the listing's bookings", e), { immediate: true });
const upcoming = computed(() => data.value?.upcoming ?? 0);
</script>

<template>
  <UiCard>
    <UiCardHeader>
      <UiCardTitle as="h2">Bookings ({{ data?.total ?? 0 }})</UiCardTitle>
      <UiCardDescription v-if="upcoming">{{ upcoming }} confirmed or waiting for an answer.</UiCardDescription>
    </UiCardHeader>
    <UiCardContent class="text-sm">
      <p v-if="error" class="text-destructive">Couldn't load the bookings. {{ loadFailedHint }}</p>
      <p v-else-if="!data?.total" class="text-muted-foreground">No bookings yet.</p>
      <template v-else>
      <p v-if="data.items.length < data.total" class="text-muted-foreground mb-2">
        Showing the latest {{ data.items.length }}. The Bookings page lists them all.
      </p>
      <ul class="space-y-1">
        <li v-for="b in data.items" :key="b.id" class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="`/bookings/${b.id}`" class="font-medium">{{ whenOf(b) }}</NuxtLink>
          <StatusBadge kind="adminBooking" :status="b.status" />
          <span class="text-muted-foreground">{{ b.customer_name }} · {{ payoutState(b) }}</span>
        </li>
      </ul>
      </template>
    </UiCardContent>
  </UiCard>
</template>
