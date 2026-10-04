<script setup lang="ts">
import { areaLabel, whereLabel, type ListingKind, type PublicListing, type PublicPhoto } from "@repo/types";

// The public listing page, for both kinds (docs/design/browse-and-listing-pages.md).
// Reads the public route, which only ever returns what a stranger may see:
// no address, and nothing about the provider but the business name.
const props = defineProps<{ kind: ListingKind }>();
const route = useRoute();
const slug = String(route.params.slug);
const plural = props.kind === "experience" ? "experiences" : "services";
const kindWord = props.kind === "experience" ? "Experiences" : "Services";

const { data: listing, error } = await useFetch<PublicListing>(`/api/public/listings/${plural}/${slug}`, {
  key: `public-listing-${plural}-${slug}`,
});
// Only a real 404 is "not found". Any other failure, including a fetch cut
// off by another navigation, is "didn't load", so a listing never reads as
// taken down because of a network blip (found 2026-10-01).
const missing = error.value ? error.value.statusCode === 404 : !listing.value;
if (error.value || !listing.value) {
  throw createError({
    statusCode: missing ? 404 : 500,
    data: missing ? { message: "We couldn't find that listing. It may have been taken down." } : undefined,
    fatal: true,
  });
}
const l = computed(() => listing.value!);

// Back from a cancelled Stripe Checkout: free the hold at once rather than
// after the checkout window (the route only expires a checkout Stripe still
// has as open; a paid one is never touched).
const checkoutCancelled = ref(false);
onMounted(async () => {
  if (route.query.checkout !== "cancelled") return;
  checkoutCancelled.value = true;
  const bookingId = typeof route.query.booking === "string" ? route.query.booking : null;
  await navigateTo({ path: route.path }, { replace: true });
  if (bookingId) {
    await $fetch(`/api/bookings/${bookingId}/abandon`, { method: "POST" }).catch(() => null);
    await refreshNuxtData(`public-listing-${plural}-${slug}`);
  }
});

// Photos come from public storage; the card copy is used for small images.
const supabase = useSupabaseClient();
const photoUrl = (path: string) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;
const smallUrl = (p: PublicPhoto) => photoUrl(p.cardPath ?? p.path);

const where = computed(() => whereLabel(l.value, l.value.market.name));
const price = computed(() => `${formatMoney(l.value.priceCents, l.value.currency)}${props.kind === "experience" ? " per person" : ""}`);
const tz = computed(() => l.value.market.timezone);
const zone = computed(() => timeZoneLabel(l.value.market.name, tz.value));
const sessionLine = (startsAt: string) => {
  const start = formatSessionTime(startsAt, tz.value);
  const end = l.value.durationMinutes
    ? ` – ${formatSessionTime(new Date(Date.parse(startsAt) + l.value.durationMinutes * 60_000).toISOString(), tz.value)}`
    : "";
  return { date: formatSessionDate(startsAt, tz.value), time: `${start}${end}` };
};
const showAllDates = ref(false);
const shownSessions = computed(() => (showAllDates.value ? l.value.sessions : l.value.sessions.slice(0, 10)));

// Full-screen viewer: the photo, its description as the caption, previous and next.
const viewerOpen = ref(false);
const viewerIndex = ref(0);
function openViewer(i: number) {
  viewerIndex.value = i;
  viewerOpen.value = true;
}
const step = (d: 1 | -1) => {
  const n = l.value.photos.length;
  viewerIndex.value = (viewerIndex.value + d + n) % n;
};
const viewed = computed(() => l.value.photos[viewerIndex.value]);

// ---------------------------------------------------------------------------
// SEO: title, description, canonical link, social preview, structured data.
// ---------------------------------------------------------------------------

const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, "");
const canonical = `${siteUrl}/${plural}/${slug}`;
// The area for the title: the listing's own, or the market for "I come to you" Services.
const titleArea = computed(() => (l.value.area ? areaLabel(l.value.area, l.value.market.name) : l.value.market.name));
const summary = computed(() => {
  const text = l.value.description.replace(/\s+/g, " ").trim();
  return text.length > 155 ? `${text.slice(0, 152).replace(/\s+\S*$/, "")}…` : text;
});
// The description leads with the category, then the listing's own words.
const metaDescription = computed(() => {
  const text = `${l.value.category.name}. ${l.value.description.replace(/\s+/g, " ").trim()}`;
  return text.length > 155 ? `${text.slice(0, 152).replace(/\s+\S*$/, "")}…` : text;
});
const hostWord = props.kind === "experience" ? "Hosted by" : "Offered by";
useSeoMeta({
  // "<title> in <area> | lokl"; the site name is added by the SEO module.
  title: () => `${l.value.title} in ${titleArea.value}`,
  description: () => metaDescription.value,
  ogTitle: () => l.value.title,
  ogDescription: () => `${price.value} · ${where.value}. ${summary.value}`,
  ogImage: () => (l.value.cover ? photoUrl(l.value.cover.path) : undefined),
  ogImageAlt: () => l.value.cover?.alt,
  ogType: "website",
  ogUrl: canonical,
});
useHead({ link: [{ rel: "canonical", href: canonical }] });

const marketPath = `/${l.value.market.slug}`;
const crumbs = computed(() => [
  { name: l.value.market.name, to: marketPath },
  { name: kindWord, to: `${marketPath}/${plural}` },
  { name: l.value.category.name, to: `${marketPath}/${plural}/${l.value.category.slug}` },
  { name: l.value.title, to: `/${plural}/${slug}` },
]);
useSchemaOrg([
  defineBreadcrumb({ itemListElement: crumbs.value.map((c) => ({ name: c.name, item: c.to })) }),
  defineProduct({
    name: l.value.title,
    description: summary.value,
    image: l.value.photos.map((p) => photoUrl(p.path)),
    brand: { "@type": "Organization", name: l.value.hostedBy },
    offers: { price: (l.value.priceCents / 100).toFixed(2), priceCurrency: l.value.currency.toUpperCase(), url: canonical },
  }),
  ...l.value.sessions.slice(0, 10).map((s) =>
    defineEvent({
      name: l.value.title,
      startDate: s.startsAt,
      ...(l.value.durationMinutes ? { endDate: new Date(Date.parse(s.startsAt) + l.value.durationMinutes * 60_000).toISOString() } : {}),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: l.value.area ? areaLabel(l.value.area, l.value.market.name) : l.value.market.name,
        address: { "@type": "PostalAddress", addressLocality: l.value.market.name, addressRegion: l.value.market.state, addressCountry: "US" },
      },
      offers: { price: (l.value.priceCents / 100).toFixed(2), priceCurrency: l.value.currency.toUpperCase(), url: canonical },
      organizer: { "@type": "Organization", name: l.value.hostedBy },
    }),
  ),
]);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 md:py-10">
    <nav aria-label="Breadcrumb" class="text-muted-foreground mb-4 text-sm">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(c, i) in crumbs" :key="c.to" class="flex items-center gap-1.5">
          <NuxtLink v-if="i < crumbs.length - 1" :to="c.to" class="hover:text-foreground">
            {{ c.name }}
          </NuxtLink>
          <span v-else aria-current="page" class="text-foreground line-clamp-1">{{ c.name }}</span>
          <Icon v-if="i < crumbs.length - 1" name="lucide:chevron-right" class="size-3.5" aria-hidden="true" />
        </li>
      </ol>
    </nav>

    <!-- Photos: the cover large, the rest in a row. Each opens the viewer. -->
    <section v-if="l.photos.length" aria-label="Photos" class="mb-8">
      <button type="button" class="block w-full overflow-hidden rounded-xl" :aria-label="`View photo 1 of ${l.photos.length}: ${l.photos[0]!.alt}`" @click="openViewer(0)">
        <NuxtImg :src="photoUrl(l.photos[0]!.path)" :alt="l.photos[0]!.alt" width="1200" height="800"
          sizes="100vw md:1152px" class="aspect-[3/2] w-full object-cover md:aspect-[5/2] lg:aspect-[3/1]" fetchpriority="high" />
      </button>
      <ul v-if="l.photos.length > 1" class="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        <li v-for="(p, i) in l.photos.slice(1)" :key="p.path">
          <button type="button" class="block w-full overflow-hidden rounded-lg" :aria-label="`View photo ${i + 2} of ${l.photos.length}: ${p.alt}`" @click="openViewer(i + 1)">
            <NuxtImg :src="smallUrl(p)" :alt="p.alt" width="600" height="450" loading="lazy" class="aspect-[4/3] w-full object-cover" />
          </button>
        </li>
      </ul>
    </section>

    <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div class="min-w-0 space-y-8">
        <!-- Room for later (docs/design/provider-profiles.md): the favourite
             heart goes at the top right of this header (a 44px button the
             title wraps short of), and the rating line directly under the
             title. Neither shows anything until its feature exists. -->
        <header class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-muted-foreground text-sm">{{ l.category.name }}</p>
            <h1 class="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{{ l.title }}</h1>
            <p class="mt-2 flex items-center gap-1.5 text-sm">
              <Icon name="lucide:map-pin" class="size-4 shrink-0" aria-hidden="true" />
              {{ where }}
            </p>
            <p v-if="!l.provider" class="text-muted-foreground mt-1 text-sm">{{ hostWord }} {{ l.hostedBy }}</p>
          </div>
        </header>

        <section aria-labelledby="about-heading">
          <h2 id="about-heading" class="text-lg font-semibold">About</h2>
          <p class="mt-2 leading-relaxed whitespace-pre-line">{{ l.description }}</p>
        </section>

        <section v-if="l.locationMode === 'customer_location' && l.travelAreas.length" aria-labelledby="where-heading">
          <h2 id="where-heading" class="text-lg font-semibold">Where they come to you</h2>
          <p class="mt-2">{{ l.travelAreas.map((a) => a.name).join(", ") }}</p>
        </section>

        <section v-if="kind === 'experience'" aria-labelledby="dates-heading">
          <h2 id="dates-heading" class="text-lg font-semibold">Upcoming dates</h2>
          <p class="text-muted-foreground text-sm">Times are {{ zone }}.</p>
          <p v-if="!l.sessions.length" class="mt-3">No dates are open right now. Check back soon.</p>
          <template v-else>
            <ul class="divide-border mt-3 divide-y rounded-lg border">
              <li v-for="s in shownSessions" :key="s.startsAt" class="flex flex-wrap justify-between gap-x-4 px-4 py-3">
                <span class="font-medium">{{ sessionLine(s.startsAt).date }}</span>
                <span class="text-muted-foreground">{{ sessionLine(s.startsAt).time }}</span>
              </li>
            </ul>
            <UiButton v-if="l.sessions.length > 10" variant="link" class="mt-2 px-0" :aria-expanded="showAllDates" @click="showAllDates = !showAllDates">
              {{ showAllDates ? "Show fewer dates" : `More dates (${l.sessions.length - 10})` }}
            </UiButton>
          </template>
        </section>

        <ProviderProfileCard v-if="l.provider" :provider="l.provider" :heading="hostWord" :more="l.moreFromProvider" :market="l.market" />
      </div>

      <!-- Price and booking: beside the details on wide screens, below them on phones. -->
      <aside aria-label="Price and booking" class="space-y-4 lg:sticky lg:top-6">
        <UiAlert v-if="checkoutCancelled" role="status">
          <UiAlertTitle>Checkout cancelled</UiAlertTitle>
          <UiAlertDescription>Nothing was charged. You can book again whenever you're ready.</UiAlertDescription>
        </UiAlert>
        <BookingPanel :listing="l" />
      </aside>
    </div>

    <UiDialog v-model:open="viewerOpen">
      <UiDialogContent class="max-w-[calc(100%-2rem)] p-3 sm:max-w-5xl sm:p-4" :title="`Photo ${viewerIndex + 1} of ${l.photos.length}`"
        :description="l.photos.length > 1 ? 'Use Previous and Next to see the others.' : undefined">
        <template #content>
          <figure v-if="viewed">
            <NuxtImg :src="photoUrl(viewed.path)" :alt="viewed.alt" width="2000" height="1333" class="max-h-[75vh] w-full rounded-md object-contain" />
            <figcaption class="mt-3 text-sm">{{ viewed.alt }}</figcaption>
          </figure>
          <div v-if="l.photos.length > 1" class="mt-3 flex justify-between">
            <UiButton variant="outline" @click="step(-1)"><Icon name="lucide:chevron-left" aria-hidden="true" /> Previous</UiButton>
            <UiButton variant="outline" @click="step(1)">Next <Icon name="lucide:chevron-right" aria-hidden="true" /></UiButton>
          </div>
        </template>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
