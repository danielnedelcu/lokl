<script setup lang="ts">
import { whereLabel, type PublicListingCard, type PublicMarket } from "@repo/types";

// One listing in a browse list: a single link, named by its title.
const props = defineProps<{ listing: PublicListingCard; market: PublicMarket }>();

const supabase = useSupabaseClient();
const coverUrl = computed(() => {
  const c = props.listing.cover;
  return c ? supabase.storage.from("listing-photos").getPublicUrl(c.cardPath ?? c.path).data.publicUrl : null;
});
const href = computed(() => `/${props.listing.kind === "experience" ? "experiences" : "services"}/${props.listing.slug}`);
const price = computed(() =>
  `${formatMoney(props.listing.priceCents, props.listing.currency)}${props.listing.kind === "experience" ? " per person" : ""}`,
);
const next = computed(() =>
  props.listing.nextSessionAt
    ? `Next: ${formatSessionDate(props.listing.nextSessionAt, props.market.timezone)}, ${formatSessionTime(props.listing.nextSessionAt, props.market.timezone)}`
    : props.listing.kind === "experience" ? "No dates yet" : null,
);
</script>

<template>
  <NuxtLink :to="href" class="group focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
    <div class="bg-muted aspect-[4/3] overflow-hidden rounded-xl">
      <NuxtImg v-if="coverUrl" :src="coverUrl" :alt="listing.cover!.alt" width="600" height="450" loading="lazy"
        class="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
    </div>
    <div class="mt-3 space-y-0.5">
      <h3 class="font-medium group-hover:underline">{{ listing.title }}</h3>
      <p class="text-muted-foreground text-sm">{{ whereLabel(listing, market.name) }}</p>
      <p class="text-sm"><span class="font-medium">{{ price }}</span></p>
      <p v-if="next" class="text-muted-foreground text-sm">{{ next }}</p>
    </div>
  </NuxtLink>
</template>
