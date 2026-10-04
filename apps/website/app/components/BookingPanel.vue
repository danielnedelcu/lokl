<script setup lang="ts">
import type { PublicListing } from "@repo/types";

// The booking box on a listing page (docs/design/booking-and-checkout.md):
// price, then sign in, "this is your listing", or the form for the kind.
const props = defineProps<{ listing: PublicListing }>();

const user = useSupabaseUser();
// Only when signed in: /api/provider is for signed-in users.
const { data: provider } = await useOwnProvider();
const ownListing = computed(() => !!provider.value && provider.value.id === props.listing.providerId);

const price = computed(() =>
  `${formatMoney(props.listing.priceCents, props.listing.currency)}${props.listing.kind === "experience" ? " per person" : ""}`,
);

// Signing in keeps them here (the sign-in dialog); the booking form takes
// the button's place, and focus goes to the panel's price above it.
const signIn = useSignIn();
const signInToBook = () => signIn.open({ title: "Sign in to book", focusAfter: "#booking-panel-start" });
</script>

<template>
  <UiCard>
    <UiCardContent class="space-y-5">
      <div>
        <p id="booking-panel-start" tabindex="-1" class="text-2xl font-semibold outline-none">{{ price }}</p>
        <p v-if="listing.durationMinutes" class="text-muted-foreground text-sm">{{ formatDuration(listing.durationMinutes) }}</p>
      </div>

      <template v-if="!user">
        <UiButton class="w-full" @click="signInToBook">Sign in to book</UiButton>
        <p class="text-muted-foreground text-sm">We'll email you a code, and you can sign in without leaving this page.</p>
      </template>
      <p v-else-if="ownListing" class="text-sm">
        This is your listing. Customers book it here.
      </p>
      <ExperienceBookingForm v-else-if="listing.kind === 'experience'" :listing="listing" />
      <ServiceBookingForm v-else :listing="listing" />

      <CancellationPolicy :kind="listing.kind" />
    </UiCardContent>
  </UiCard>
</template>
