<script setup lang="ts">
import {
  citySchema,
  serviceAreaSchema,
  US_TIME_ZONES,
  type City,
  type CityInput,
  type ServiceArea,
  type ServiceAreaInput,
} from "@repo/types";

useHead({ title: "Markets and areas · Admin" });

const supabase = useSupabaseClient();

// Admin-only reference lists: read and written from here under admin-only
// database rules (apps/admin/CLAUDE.md). The admin sees inactive rows too.
const { data, error, pending, refresh } = await useAsyncData("admin-cities-and-areas", async () => {
  const [cities, areas] = await Promise.all([
    supabase.from("cities").select("*").order("sort_order").order("name"),
    supabase.from("service_areas").select("*").order("sort_order").order("name"),
  ]);
  if (cities.error) throw cities.error;
  if (areas.error) throw areas.error;
  return { cities: cities.data as City[], areas: areas.data as ServiceArea[] };
});

const cities = computed(() => data.value?.cities ?? []);
const selectedCityId = ref<string>("");
watchEffect(() => {
  if (!cities.value.some((c) => c.id === selectedCityId.value)) selectedCityId.value = cities.value[0]?.id ?? "";
});
const selectedCity = computed(() => cities.value.find((c) => c.id === selectedCityId.value));
const areas = computed(() => (data.value?.areas ?? []).filter((a) => a.city_id === selectedCityId.value));

const timeZoneLabel = (tz: string) => US_TIME_ZONES.find((t) => t.value === tz)?.label ?? tz;
const areaKindLabel = { neighborhood: "Neighborhood", city: "City or town", zip: "Zip code" } as const;

const cityColumns = [
  { accessorKey: "name", header: "Market" },
  { accessorKey: "slug", header: "Slug" },
  { accessorKey: "timezone", header: "Time zone" },
  { accessorKey: "active", header: "Status" },
  { id: "actions", header: "", enableSorting: false },
];
const areaColumns = [
  { id: "order", header: "Order", enableSorting: false },
  { accessorKey: "name", header: "Area", enableSorting: false },
  { accessorKey: "kind", header: "Type", enableSorting: false },
  { accessorKey: "active", header: "Status", enableSorting: false },
  { id: "actions", header: "", enableSorting: false },
];

const busy = ref(false);

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

const cityDialogOpen = ref(false);
const editingCity = ref<City | null>(null);
const citySlugEdited = ref(false);
const cityForm = useForm<CityInput>({ validationSchema: zodSchema(citySchema) });

function openCreateCity() {
  editingCity.value = null;
  citySlugEdited.value = false;
  cityForm.resetForm({ values: { name: "", slug: "", state: "", timezone: "America/New_York" } });
  cityDialogOpen.value = true;
}
function openEditCity(city: City) {
  editingCity.value = city;
  citySlugEdited.value = true;
  cityForm.resetForm({ values: { name: city.name, slug: city.slug, state: city.state, timezone: city.timezone } });
  cityDialogOpen.value = true;
}
watch(
  () => cityForm.values.name,
  (name) => {
    if (!citySlugEdited.value) cityForm.setFieldValue("slug", slugify(name ?? ""));
  },
);

const saveCity = cityForm.handleSubmit(async (input) => {
  const { error } = editingCity.value
    ? await supabase.from("cities").update(input).eq("id", editingCity.value.id)
    : await supabase.from("cities").insert({ ...input, sort_order: cities.value.length });
  if (error?.code === "23505") {
    cityForm.setFieldError("slug", "Another market already uses this slug. Choose a different one.");
    return;
  }
  if (error) return useSonner.error(reportProblem("The market wasn't saved. Try again.", error));
  useSonner.success(editingCity.value ? "Market saved." : "Market added.");
  cityDialogOpen.value = false;
  await refresh();
});

async function toggleCity(city: City) {
  busy.value = true;
  const { error } = await supabase.from("cities").update({ active: !city.active }).eq("id", city.id);
  busy.value = false;
  if (error) return useSonner.error(reportProblem("That didn't work. Try again.", error));
  useSonner.success(
    city.active
      ? `${city.name} is now inactive. It's hidden from the public site, and new providers can't choose it.`
      : `${city.name} is active again.`,
  );
  await refresh();
}

// Deactivating asks first, saying how many live listings it hides.
const deactivating = ref<City | null>(null);
const deactivateOpen = ref(false);
const liveCount = ref<number | null>(null);
async function askDeactivate(item: City) {
  deactivating.value = item;
  liveCount.value = null;
  deactivateOpen.value = true;
  const { count, error } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("city_id", item.id)
    .eq("status", "live");
  if (error) {
    deactivateOpen.value = false;
    return useSonner.error(reportProblem("Couldn't count its live listings. Try again.", error));
  }
  liveCount.value = count ?? 0;
}
async function confirmDeactivate() {
  if (!deactivating.value) return;
  await toggleCity(deactivating.value);
  deactivateOpen.value = false;
}

// ---------------------------------------------------------------------------
// Service areas
// ---------------------------------------------------------------------------

const areaDialogOpen = ref(false);
const editingArea = ref<ServiceArea | null>(null);
const areaForm = useForm<ServiceAreaInput>({ validationSchema: zodSchema(serviceAreaSchema) });

function openCreateArea() {
  editingArea.value = null;
  areaForm.resetForm({ values: { kind: "neighborhood", name: "" } });
  areaDialogOpen.value = true;
}
function openEditArea(area: ServiceArea) {
  editingArea.value = area;
  areaForm.resetForm({ values: { kind: area.kind, name: area.name } });
  areaDialogOpen.value = true;
}

const saveArea = areaForm.handleSubmit(async (input) => {
  const { error } = editingArea.value
    ? await supabase.from("service_areas").update(input).eq("id", editingArea.value.id)
    : await supabase
        .from("service_areas")
        .insert({ ...input, city_id: selectedCityId.value, sort_order: areas.value.length });
  if (error?.code === "23505") {
    areaForm.setFieldError("name", `${selectedCity.value?.name} already has an area with this name.`);
    return;
  }
  if (error) return useSonner.error(reportProblem("The area wasn't saved. Try again.", error));
  useSonner.success(editingArea.value ? "Area saved." : "Area added.");
  areaDialogOpen.value = false;
  await refresh();
});

async function toggleArea(area: ServiceArea) {
  busy.value = true;
  const { error } = await supabase.from("service_areas").update({ active: !area.active }).eq("id", area.id);
  busy.value = false;
  if (error) return useSonner.error(reportProblem("That didn't work. Try again.", error));
  useSonner.success(area.active ? `${area.name} is now inactive.` : `${area.name} is active again.`);
  await refresh();
}

async function moveArea(index: number, direction: -1 | 1) {
  busy.value = true;
  try {
    await saveOrder(supabase, "service_areas", areas.value, index, direction);
  } catch (e) {
    useSonner.error(reportProblem("The new order wasn't saved. Try again.", e));
  }
  busy.value = false;
  await refresh();
}
watch(error, (e) => e && reportProblem("Couldn't load markets", e), { immediate: true });
</script>

<template>
  <div class="space-y-10">
    <PageHeader
      title="Markets and areas"
      description="A market is a metro area lokl operates in, named after its main city: Atlanta covers the whole metro. Areas are the places inside a market (neighborhoods, cities and towns like Decatur, and zip codes). Only admins can change these."
    />

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load markets</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <template v-else>
      <!-- Cities -->
      <section aria-labelledby="cities-heading" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 id="cities-heading" class="text-lg font-semibold">Markets</h2>
          <UiButton size="sm" @click="openCreateCity">New market</UiButton>
        </div>
        <EmptyState
          v-if="!pending && !cities.length"
          icon="lucide:map-pin"
          title="No markets yet"
          description="Add a market before providers sign up, so they can choose where they work."
        />
        <UiCard v-else class="py-0">
          <UiTanStackTable
            :data="cities"
            :columns="cityColumns"
            :loading="pending"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}, {{ row.original.state }}</span>
            </template>
            <template #slug-cell="{ row }">
              <code class="text-muted-foreground text-xs">{{ row.original.slug }}</code>
            </template>
            <template #timezone-cell="{ row }">
              <span class="text-muted-foreground">{{ timeZoneLabel(row.original.timezone) }}</span>
            </template>
            <template #active-cell="{ row }">
              <StatusBadge kind="record" :status="row.original.active ? 'active' : 'inactive'" />
            </template>
            <template #actions-cell="{ row }">
              <div class="flex justify-end gap-2">
                <UiButton size="sm" variant="outline" :aria-label="`Edit ${row.original.name}`" @click="openEditCity(row.original)">
                  Edit
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  :aria-label="`${row.original.active ? 'Deactivate' : 'Reactivate'} ${row.original.name}`"
                  @click="row.original.active ? askDeactivate(row.original) : toggleCity(row.original)"
                >
                  {{ row.original.active ? "Deactivate" : "Reactivate" }}
                </UiButton>
              </div>
            </template>
          </UiTanStackTable>
        </UiCard>
      </section>

      <!-- Service areas of the selected city -->
      <section v-if="cities.length" aria-labelledby="areas-heading" class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="areas-heading" class="text-lg font-semibold">Areas in the {{ selectedCity?.name }} market</h2>
            <p class="text-muted-foreground text-sm">
              Where "I come to you" Services travel, and the location shown on listings.
            </p>
          </div>
          <div class="flex items-end gap-2">
            <div v-if="cities.length > 1">
              <UiLabel for="area-city" class="mb-1">Show areas in</UiLabel>
              <SelectInput id="area-city" v-model="selectedCityId" class="min-w-48"
                :options="cities.map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` }))" />
            </div>
            <UiButton size="sm" @click="openCreateArea">New area</UiButton>
          </div>
        </div>
        <EmptyState
          v-if="!pending && !areas.length"
          icon="lucide:map"
          :title="`No areas in ${selectedCity?.name} yet`"
          description="Add neighborhoods, cities and towns, or zip codes. You'll need them before the first &quot;I come to you&quot; Service goes live."
        />
        <UiCard v-else class="py-0">
          <UiTanStackTable
            :data="areas"
            :columns="areaColumns"
            :loading="pending"
          >
            <template #order-cell="{ row }">
              <div class="flex gap-1">
                <UiButton
                  size="icon-sm"
                  variant="ghost"
                  :disabled="busy || row.index === 0"
                  :aria-label="`Move ${row.original.name} up`"
                  @click="moveArea(row.index, -1)"
                >
                  <Icon name="lucide:arrow-up" aria-hidden="true" />
                </UiButton>
                <UiButton
                  size="icon-sm"
                  variant="ghost"
                  :disabled="busy || row.index === areas.length - 1"
                  :aria-label="`Move ${row.original.name} down`"
                  @click="moveArea(row.index, 1)"
                >
                  <Icon name="lucide:arrow-down" aria-hidden="true" />
                </UiButton>
              </div>
            </template>
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}</span>
            </template>
            <template #kind-cell="{ row }">
              <span class="text-muted-foreground">{{ areaKindLabel[row.original.kind] }}</span>
            </template>
            <template #active-cell="{ row }">
              <StatusBadge kind="record" :status="row.original.active ? 'active' : 'inactive'" />
            </template>
            <template #actions-cell="{ row }">
              <div class="flex justify-end gap-2">
                <UiButton size="sm" variant="outline" :aria-label="`Edit ${row.original.name}`" @click="openEditArea(row.original)">
                  Edit
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  :aria-label="`${row.original.active ? 'Deactivate' : 'Reactivate'} ${row.original.name}`"
                  @click="toggleArea(row.original)"
                >
                  {{ row.original.active ? "Deactivate" : "Reactivate" }}
                </UiButton>
              </div>
            </template>
          </UiTanStackTable>
        </UiCard>
      </section>
    </template>

    <!-- City dialog -->
    <UiDialog v-model:open="cityDialogOpen">
      <UiDialogContent
        :title="editingCity ? `Edit ${editingCity.name}` : 'New market'"
        :description="editingCity ? 'Changes show on the public site right away.' : 'Providers can choose it once it exists and is active.'"
      >
        <template #content>
          <form id="city-form" class="space-y-4" novalidate @submit="saveCity">
            <UiVeeInput name="name" label="Market name" required placeholder="e.g. Atlanta"
              hint="Named after its main city. The market covers the whole metro; surrounding cities are added as areas." />
            <UiVeeInput
              name="slug"
              label="Slug"
              required
              hint="Used in web addresses. Lowercase letters, numbers and hyphens."
              @input="citySlugEdited = true"
            />
            <UiVeeInput name="state" label="State" required maxlength="2" hint="Two-letter code, like GA." />
            <UiVeeSelect name="timezone" label="Time zone" required hint="Experience session times are shown in it."
              placeholder="Choose a time zone" :options="US_TIME_ZONES.map((t) => ({ value: t.value, label: `${t.label} (${t.value})` }))" />
          </form>
        </template>
        <template #footer>
          <UiDialogFooter>
            <UiButton variant="outline" @click="cityDialogOpen = false">Cancel</UiButton>
            <UiButton type="submit" form="city-form" :disabled="cityForm.isSubmitting.value">
              {{ cityForm.isSubmitting.value ? "Saving…" : editingCity ? "Save changes" : "Add city" }}
            </UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>

    <!-- Area dialog -->
    <UiDialog v-model:open="areaDialogOpen">
      <UiDialogContent
        :title="editingArea ? `Edit ${editingArea.name}` : `New area in ${selectedCity?.name}`"
        description="A neighborhood, a city or town inside the market (like Decatur), or a five-digit zip code."
      >
        <template #content>
          <form id="area-form" class="space-y-4" novalidate @submit="saveArea">
            <UiVeeSelect name="kind" label="Type" required placeholder="Choose a type" :options="[
              { value: 'neighborhood', label: 'Neighborhood' },
              { value: 'city', label: 'City or town' },
              { value: 'zip', label: 'Zip code' },
            ]" />
            <UiVeeInput name="name" label="Name or zip code" required placeholder="e.g. Old Fourth Ward, Decatur or 30312" />
          </form>
        </template>
        <template #footer>
          <UiDialogFooter>
            <UiButton variant="outline" @click="areaDialogOpen = false">Cancel</UiButton>
            <UiButton type="submit" form="area-form" :disabled="areaForm.isSubmitting.value">
              {{ areaForm.isSubmitting.value ? "Saving…" : editingArea ? "Save changes" : "Add area" }}
            </UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>
    <DeactivateDialog v-model:open="deactivateOpen" :name="deactivating ? deactivating.name : ''" :live-count="liveCount"
      :busy="busy" @confirm="confirmDeactivate" />
  </div>
</template>
