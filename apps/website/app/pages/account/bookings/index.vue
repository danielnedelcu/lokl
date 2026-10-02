<script setup lang="ts">
// My bookings: anyone's own bookings as a customer (docs/design/booking-and-checkout.md).
// Bookings of a provider's listings are in their dashboard.
definePageMeta({ layout: "public" });
useSeoMeta({ title: "My bookings" });

interface Item {
  id: string;
  kind: "service" | "experience";
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  preferred_times: string[] | null;
  party_size: number;
  total_cents: number;
  respond_by: string | null;
  listing: { title: string; slug: string; kind: string; timezone: string; cover: { path: string; alt: string } | null } | null;
}
const { data, error, pending, refresh } = await useFetch<Item[]>("/api/account/bookings", { key: "my-bookings" });
useLiveData({ refresh });

const supabase = useSupabaseClient();
const photo = (path: string) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;
const when = (b: Item) => {
  const tz = b.listing?.timezone ?? "America/New_York";
  if (b.starts_at) return `${formatSessionDate(b.starts_at, tz)}, ${formatSessionTime(b.starts_at, tz)}`;
  if (b.preferred_times?.length) return `You offered ${b.preferred_times.length === 1 ? "1 time" : `${b.preferred_times.length} times`}`;
  return "";
};
const isPast = (b: Item) => ["declined", "expired", "cancelled", "completed", "paid_out"].includes(b.status)
  || (!!b.ends_at && Date.parse(b.ends_at) < Date.now());
const upcoming = computed(() => (data.value ?? []).filter((b) => !isPast(b)));
const past = computed(() => (data.value ?? []).filter(isPast));
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight">My bookings</h1>

    <UiAlert v-if="error" variant="destructive" class="mt-6">
      <UiAlertTitle>Your bookings didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending" class="text-muted-foreground mt-6 text-sm">Loading…</p>
    <div v-else-if="!data?.length" class="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
      <p class="font-medium">No bookings yet.</p>
      <p class="text-muted-foreground mt-1 text-sm">When you book something, it shows up here.</p>
      <div class="mt-4 flex flex-wrap justify-center gap-3">
        <UiButton to="/atlanta/experiences">Browse Experiences</UiButton>
        <UiButton variant="outline" to="/atlanta/services">Browse Services</UiButton>
      </div>
    </div>
    <template v-else>
      <section v-for="group in [{ title: 'Upcoming', items: upcoming }, { title: 'Past', items: past }]" :key="group.title"
        :aria-labelledby="`${group.title}-heading`" class="mt-8">
        <template v-if="group.items.length">
          <h2 :id="`${group.title}-heading`" class="text-lg font-semibold">{{ group.title }}</h2>
          <ul class="divide-border mt-3 divide-y rounded-lg border">
            <li v-for="b in group.items" :key="b.id">
              <NuxtLink :to="`/account/bookings/${b.id}`" class="hover:bg-accent flex items-center gap-4 p-3">
                <div class="bg-muted size-16 shrink-0 overflow-hidden rounded-md">
                  <NuxtImg v-if="b.listing?.cover" :src="photo(b.listing.cover.path)" :alt="b.listing.cover.alt" width="128" height="128" class="h-full w-full object-cover" loading="lazy" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{{ b.listing?.title ?? "A listing" }}</p>
                  <p class="text-muted-foreground text-sm">{{ when(b) }}</p>
                </div>
                <StatusBadge kind="booking" :status="b.status" />
              </NuxtLink>
            </li>
          </ul>
        </template>
      </section>
    </template>
  </div>
</template>
