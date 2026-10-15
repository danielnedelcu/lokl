<script setup lang="ts">
import { marketZone } from "@repo/types";
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
  service_mode: "instant" | "approve" | null;
  party_size: number;
  total_cents: number;
  respond_by: string | null;
  listing: { title: string; slug: string; kind: string; timezone: string; cover: { path: string; alt: string } | null } | null;
}
// Upcoming and Past, 20 at a time, each counted and paged by the database.
interface Page { items: Item[]; total: number; page: number; pageSize: number }
const fetchGroup = (group: "upcoming" | "past", page = 1) =>
  useRequestFetch()<Page>("/api/account/bookings", { query: { group, page } });
const { data, error, pending, refresh } = await useAsyncData("my-bookings", async () => {
  const [upcoming, past] = await Promise.all([fetchGroup("upcoming"), fetchGroup("past")]);
  return { upcoming, past };
});
useLiveData({ refresh });

const more = reactive({ upcoming: [] as Item[], past: [] as Item[] });
watch(data, () => {
  more.upcoming = [];
  more.past = [];
});
const groups = computed(() => (["upcoming", "past"] as const).map((key) => ({
  key,
  title: key === "upcoming" ? "Upcoming" : "Past",
  items: [...(data.value?.[key].items ?? []), ...more[key]],
  total: data.value?.[key].total ?? 0,
})));
const loadingMore = ref<"" | "upcoming" | "past">("");
const moreError = ref("");
async function showMore(key: "upcoming" | "past") {
  loadingMore.value = key;
  moreError.value = "";
  const firstNew = groups.value.find((g) => g.key === key)!.items.length;
  try {
    const next = await fetchGroup(key, Math.floor(firstNew / (data.value?.[key].pageSize ?? 20)) + 1);
    more[key] = [...more[key], ...next.items];
    // Focus the first new booking, so keyboard users carry on from there.
    await nextTick();
    document.querySelectorAll<HTMLElement>(`[data-booking="${key}"]`)[firstNew]?.focus();
  } catch {
    moreError.value = "More bookings didn't load. Try again.";
  } finally {
    loadingMore.value = "";
  }
}

const supabase = useSupabaseClient();
const photo = (path: string) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;
// A declined or expired booking never took place: it leads with that, and
// the time is what was asked for, not when something happened.
const when = (b: Item) => {
  const tz = marketZone(b.listing, `booking ${b.id}`);
  const at = b.starts_at ? `${formatSessionDate(b.starts_at, tz)}, ${formatSessionTime(b.starts_at, tz)}` : "";
  if (b.status === "declined" || b.status === "expired") {
    const word = b.status === "declined" ? "Declined" : "Expired";
    return at ? `${word} · you asked for ${at}` : word;
  }
  return at;
};
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8 md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight">My bookings</h1>

    <UiAlert v-if="error" variant="destructive" class="mt-6">
      <UiAlertTitle>Your bookings didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending" class="text-muted-foreground mt-6 text-sm">Loading…</p>
    <div v-else-if="!data?.upcoming.total && !data?.past.total" class="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
      <p class="font-medium">No bookings yet.</p>
      <p class="text-muted-foreground mt-1 text-sm">When you book something, it shows up here.</p>
      <div class="mt-4 flex flex-wrap justify-center gap-3">
        <NuxtLink to="/atlanta/experiences" class="link-primary">Browse Experiences</NuxtLink>
        <NuxtLink to="/atlanta/services" class="link-secondary">Browse Services</NuxtLink>
      </div>
    </div>
    <template v-else>
      <section v-for="group in groups" :key="group.key" :aria-labelledby="`${group.key}-heading`" class="mt-8">
        <template v-if="group.total">
          <h2 :id="`${group.key}-heading`" class="text-lg font-semibold">{{ group.title }} ({{ group.total }})</h2>
          <ul class="divide-border mt-3 divide-y rounded-lg border">
            <li v-for="b in group.items" :key="b.id">
              <NuxtLink :to="`/account/bookings/${b.id}`" :data-booking="group.key" class="hover:bg-accent flex items-center gap-4 p-3">
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
          <UiButton v-if="group.items.length < group.total" variant="outline" class="mt-3" :disabled="!!loadingMore" @click="showMore(group.key)">
            {{ loadingMore === group.key ? "Loading…" : `Show more ${group.title.toLowerCase()} bookings` }}
          </UiButton>
        </template>
      </section>
      <p v-if="moreError" role="alert" class="text-destructive mt-2 text-sm">{{ moreError }}</p>
    </template>
  </div>
</template>
