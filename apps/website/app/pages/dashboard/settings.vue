<script setup lang="ts">
import { providerProfileSchema, type City, type ProviderProfileInput } from "@repo/types";

definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Business profile" });

const supabase = useSupabaseClient();
const { data: provider, refresh } = await useProvider();

// RLS returns active cities only, so the picker never offers an inactive one.
const { data: cities } = await useAsyncData("active-cities", async () => {
  const { data, error } = await supabase
    .from("cities")
    .select("id, slug, name, state, timezone, active, sort_order")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return data as City[];
});

const savedCityId = provider.value?.city_id ?? "";
// A saved city that's no longer offered (deactivated) has to be re-picked.
const savedCityGone = !!savedCityId && !cities.value?.some((c) => c.id === savedCityId);

const { handleSubmit, isSubmitting, values } = useForm<ProviderProfileInput>({
  validationSchema: zodSchema(providerProfileSchema),
  initialValues: {
    display_name: provider.value?.display_name ?? "",
    // New profiles with only one city on offer start with it selected.
    city_id: savedCityGone ? "" : savedCityId || (cities.value?.length === 1 ? cities.value[0]!.id : ""),
    headline: provider.value?.headline ?? "",
    bio: provider.value?.bio ?? "",
  },
});

// The public profile exists while the provider can be booked: active, with
// a live listing (docs/design/provider-profiles.md).
const { data: liveListings, refresh: refreshLive } = await useAsyncData("own-live-listings", async () => {
  if (!provider.value) return 0;
  const { count } = await supabase.from("listings").select("id", { count: "exact", head: true })
    .eq("provider_id", provider.value.id).eq("status", "live");
  return count ?? 0;
});
const profilePublic = computed(() => provider.value?.status === "active" && (liveListings.value ?? 0) > 0);
async function photosChanged() {
  await Promise.all([refresh(), refreshLive()]);
}

const save = handleSubmit(async (values) => {
  try {
    await $fetch("/api/provider", { method: "POST", body: values });
    await refresh();
    useSonner.success("Business profile saved.");
  } catch (e) {
    useSonner.error((e as { statusMessage?: string }).statusMessage ?? "Your profile wasn't saved. Please try again.");
  }
});
</script>

<template>
  <div class="max-w-lg">
    <h1 class="text-2xl font-semibold tracking-tight">Business profile</h1>
    <p class="mt-1 text-sm text-muted-foreground">This is how customers see you: on your listings and on your public profile.</p>

    <UiCard class="mt-6">
      <UiCardContent>
        <form class="space-y-5" novalidate @submit="save">
          <UiVeeInput name="display_name" label="Business or host name" autocomplete="organization" required />

          <!-- A "city" in the database is a market covering its whole metro
               (docs/decisions.md, 2026-09-30). The hint names Atlanta while
               it's the only market. -->
          <UiVeeSelect
            name="city_id"
            label="Metro area"
            required
            touch
            placeholder="Choose your metro area"
            :options="(cities ?? []).map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))"
            :hint="savedCityGone ? 'Your metro area is no longer on the list. Please choose another one.' : 'Atlanta covers the whole metro, including Decatur, Sandy Springs and Alpharetta.'"
          />

          <UiVeeInput name="headline" label="Headline (optional)" maxlength="80"
            :hint="`One line about what you do, like “Food walks through Atlanta's oldest neighborhoods”. Public. ${values.headline?.length ?? 0} / 80`" />
          <UiVeeTextarea name="bio" label="About you (optional)" :rows="6" maxlength="1000"
            :hint="`Who you are and what customers can expect. Public on your profile. Leave out phone numbers, emails and links: customers reach you through bookings. ${values.bio?.length ?? 0} / 1,000`" />

          <UiButton type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? "Saving…" : provider ? "Save changes" : "Create profile" }}
          </UiButton>
        </form>
      </UiCardContent>
    </UiCard>

    <!-- Photos: each saved on its own, once the business exists. -->
    <UiCard v-if="provider" class="mt-6">
      <UiCardContent class="space-y-8">
        <ProfilePhotoField kind="avatar" :provider="provider" @changed="photosChanged" />
        <ProfilePhotoField kind="cover" :provider="provider" @changed="photosChanged" />
      </UiCardContent>
    </UiCard>

    <p v-if="provider" class="mt-6 text-sm">
      <NuxtLink v-if="profilePublic" :to="`/providers/${provider.slug}`" class="font-medium">See your public profile</NuxtLink>
      <span v-else class="text-muted-foreground">Your public profile appears once one of your listings is live.</span>
    </p>
  </div>
</template>
