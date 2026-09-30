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

const { handleSubmit, isSubmitting } = useForm<ProviderProfileInput>({
  validationSchema: zodSchema(providerProfileSchema),
  initialValues: {
    display_name: provider.value?.display_name ?? "",
    // New profiles with only one city on offer start with it selected.
    city_id: savedCityGone ? "" : savedCityId || (cities.value?.length === 1 ? cities.value[0]!.id : ""),
  },
});

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
    <p class="mt-1 text-sm text-muted-foreground">This is how customers will see you on your listings.</p>

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
            :hint="savedCityGone ? 'Your metro area is no longer on the list. Please choose another one.' : 'Atlanta covers the whole metro, including Decatur, Sandy Springs and Alpharetta.'"
          >
            <option value="" disabled>Choose your metro area</option>
            <option v-for="c in cities" :key="c.id" :value="c.id">{{ c.name }}, {{ c.state }}</option>
          </UiVeeSelect>

          <UiButton type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? "Saving…" : provider ? "Save changes" : "Create profile" }}
          </UiButton>
        </form>
      </UiCardContent>
    </UiCard>
  </div>
</template>
