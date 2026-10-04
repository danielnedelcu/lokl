<script setup lang="ts">
import type { MySaved } from "@repo/types";
import type { SavedKind } from "~/composables/useSaved";

// Saved: the listings and providers this customer saved
// (docs/design/favourites.md, The Saved page). Newest saved first, with the
// ones no longer available at the end of each section. Unsaving here keeps
// the item on the page, greyed, with "Undo", until the next visit.
definePageMeta({ layout: "public" });
useSeoMeta({ title: "Saved" });

const { data, error, pending } = await useFetch<MySaved>("/api/account/saved", { key: "my-saved" });
const { load, loaded, isSaved, toggle } = useSaved();
onMounted(() => void load());

const listings = computed(() => {
  const all = data.value?.listings ?? [];
  return { available: all.filter((l) => l.card), gone: all.filter((l) => !l.card), count: all.length };
});
const providers = computed(() => {
  const all = data.value?.providers ?? [];
  return { available: all.filter((p) => p.provider), gone: all.filter((p) => !p.provider), count: all.length };
});
const empty = computed(() => !listings.value.count && !providers.value.count);
// Removed on this visit (only known once the hearts' state has loaded).
const removed = (kind: SavedKind, id: string) => loaded.value && !isSaved(kind, id);
const goneListing = (title: string | null) => title ?? "A listing that's no longer available";
const goneProvider = (name: string | null) => name ?? "A provider who's no longer available";
const profileHref = (slug: string) => `/providers/${slug}`;
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8 md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight">Saved</h1>

    <UiAlert v-if="error" variant="destructive" class="mt-6">
      <UiAlertTitle>Your saved items didn't load</UiAlertTitle>
      <UiAlertDescription>Reload the page to try again.</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending" class="text-muted-foreground mt-6 text-sm">Loading…</p>
    <div v-else-if="empty" class="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
      <p class="font-medium">Nothing saved yet.</p>
      <p class="text-muted-foreground mt-1 text-sm">Tap the heart on a listing or a provider to keep it here.</p>
      <div class="mt-4 flex flex-wrap justify-center gap-3">
        <UiButton to="/atlanta/experiences">Browse Experiences</UiButton>
        <UiButton variant="outline" to="/atlanta/services">Browse Services</UiButton>
      </div>
    </div>
    <template v-else>
      <section v-if="listings.count" aria-labelledby="saved-listings-heading" class="mt-8">
        <h2 id="saved-listings-heading" class="text-lg font-semibold">Listings ({{ listings.count }})</h2>
        <ul v-if="listings.available.length" class="mt-4 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="l in listings.available" :key="l.id">
            <div :class="removed('listing', l.id) && 'opacity-60'">
              <ListingCard :listing="l.card!" :market="l.card!.market" />
            </div>
            <p v-if="removed('listing', l.id)" class="mt-2 text-sm">
              Removed.
              <button type="button" class="hover:bg-accent -mx-1 min-h-11 rounded px-1 font-medium" :aria-label="`Undo: save ${l.card!.title} again`"
                @click="toggle('listing', l.id, l.card!.title)">Undo</button>
            </p>
          </li>
        </ul>
        <ul v-if="listings.gone.length" class="divide-border mt-6 divide-y rounded-lg border">
          <li v-for="l in listings.gone" :key="l.id" class="flex items-center gap-4 p-3" :class="removed('listing', l.id) && 'opacity-60'">
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ goneListing(l.title) }}</p>
              <p class="text-muted-foreground text-sm">No longer available</p>
            </div>
            <p v-if="removed('listing', l.id)" class="text-sm">Removed</p>
            <UiButton v-else variant="outline" size="sm" class="min-h-11" :disabled="!loaded"
              :aria-label="`Remove ${goneListing(l.title)}`" @click="toggle('listing', l.id, goneListing(l.title))">Remove</UiButton>
          </li>
        </ul>
      </section>

      <section v-if="providers.count" aria-labelledby="saved-providers-heading" class="mt-10">
        <h2 id="saved-providers-heading" class="text-lg font-semibold">Providers ({{ providers.count }})</h2>
        <ul v-if="providers.available.length" class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="s in providers.available" :key="s.id">
            <div class="border-border flex items-start gap-3 rounded-lg border p-3" :class="removed('provider', s.id) && 'opacity-60'">
              <ProviderAvatar :name="s.provider!.name" :path="s.provider!.avatarSmallPath ?? s.provider!.avatarPath" :size="48" />
              <div class="min-w-0 flex-1">
                <NuxtLink :to="profileHref(s.provider!.slug)" class="font-medium">{{ s.provider!.name }}</NuxtLink>
                <p v-if="s.provider!.headline" class="text-muted-foreground mt-0.5 text-sm">{{ s.provider!.headline }}</p>
              </div>
              <SaveButton kind="provider" :id="s.id" :name="s.provider!.name" :provider-id="s.id" />
            </div>
            <p v-if="removed('provider', s.id)" class="mt-2 text-sm">
              Removed.
              <button type="button" class="hover:bg-accent -mx-1 min-h-11 rounded px-1 font-medium" :aria-label="`Undo: save ${s.provider!.name} again`"
                @click="toggle('provider', s.id, s.provider!.name)">Undo</button>
            </p>
          </li>
        </ul>
        <ul v-if="providers.gone.length" class="divide-border mt-6 divide-y rounded-lg border">
          <li v-for="s in providers.gone" :key="s.id" class="flex items-center gap-4 p-3" :class="removed('provider', s.id) && 'opacity-60'">
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ goneProvider(s.name) }}</p>
              <p class="text-muted-foreground text-sm">No longer available</p>
            </div>
            <p v-if="removed('provider', s.id)" class="text-sm">Removed</p>
            <UiButton v-else variant="outline" size="sm" class="min-h-11" :disabled="!loaded"
              :aria-label="`Remove ${goneProvider(s.name)}`" @click="toggle('provider', s.id, goneProvider(s.name))">Remove</UiButton>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
