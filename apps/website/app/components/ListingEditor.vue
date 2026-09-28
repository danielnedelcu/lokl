<script setup lang="ts">
import {
  listingReadiness,
  listingSchema,
  needsAddress,
  payoutSetupOf,
  type ListingInput,
  type ListingKind,
  type Listing,
  type ListingAddress,
} from "@repo/types";

// Create (no listingId) or edit a Service or Experience. Listing fields,
// the address and travel areas are written through the Supabase client under
// the database's rules; publish, submit and unlist go through server routes.
const props = defineProps<{ kind?: ListingKind; listingId?: string }>();

const supabase = useSupabaseClient();
const { data: provider } = await useProvider();

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// Active reference lists only (RLS returns active rows to providers).
const { data: refs } = await useAsyncData("listing-editor-refs", async () => {
  const [cities, areas] = await Promise.all([
    supabase.from("cities").select("id, name, state, timezone").order("sort_order").order("name"),
    supabase.from("service_areas").select("id, city_id, kind, name").order("sort_order").order("name"),
  ]);
  for (const r of [cities, areas]) if (r.error) throw r.error;
  return {
    cities: cities.data as { id: string; name: string; state: string; timezone: string }[],
    areas: areas.data as { id: string; city_id: string; kind: string; name: string }[],
  };
});

const { data: saved, refresh: refreshSaved } = await useAsyncData(`listing-${props.listingId ?? "new"}`, async () => {
  if (!props.listingId) return null;
  const [listing, address, travel, photos, sessions] = await Promise.all([
    supabase.from("listings").select("*").eq("id", props.listingId).maybeSingle(),
    supabase.from("listing_addresses").select("*").eq("listing_id", props.listingId).maybeSingle(),
    supabase.from("listing_service_areas").select("service_area_id").eq("listing_id", props.listingId),
    supabase.from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", props.listingId),
    supabase.from("experience_sessions").select("id", { count: "exact", head: true })
      .eq("listing_id", props.listingId).eq("status", "scheduled").gt("starts_at", new Date().toISOString()),
  ]);
  for (const r of [listing, address, travel, photos, sessions]) if (r.error) throw r.error;
  return {
    listing: listing.data as Listing | null,
    address: address.data as ListingAddress | null,
    travelAreaIds: (travel.data ?? []).map((r: { service_area_id: string }) => r.service_area_id),
    photoCount: photos.count ?? 0,
    upcomingSessionCount: sessions.count ?? 0,
  };
});

const listing = computed(() => saved.value?.listing ?? null);
const notFound = computed(() => !!props.listingId && (!listing.value || listing.value.provider_id !== provider.value?.id));
const kind = computed<ListingKind>(() => listing.value?.kind ?? props.kind ?? "service");
const status = computed(() => listing.value?.status ?? "draft");
const kindWord = computed(() => (kind.value === "service" ? "Service" : "Experience"));

// What can change, by status (the database enforces the same rules).
const editable = computed(() => status.value === "draft" || status.value === "rejected");
const priceAndDescriptionEditable = computed(() => editable.value || status.value === "live");
const travelAreasEditable = computed(() => editable.value || status.value === "live");

// Only this listing's kind, filtered in the query. Loaded after the listing,
// since an edited listing's kind comes from the listing itself.
const { data: categoryRows } = await useAsyncData(
  () => `listing-editor-categories-${kind.value}`,
  async () => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name")
      .eq("kind", kind.value)
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data as { id: string; name: string }[];
  },
);
const categories = computed(() => categoryRows.value ?? []);
const cities = computed(() => refs.value?.cities ?? []);

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

const emptyAddress = () => ({ line1: "", line2: "", city: "", state: "GA", postal_code: "", instructions: "" });

function formValues(): ListingInput {
  const l = listing.value;
  const a = saved.value?.address;
  const cityIds = cities.value.map((c) => c.id);
  const providerCity = provider.value?.city_id && cityIds.includes(provider.value.city_id) ? provider.value.city_id : "";
  return {
    kind: kind.value,
    category_id: l?.category_id ?? "",
    city_id: l?.city_id ?? (providerCity || cityIds[0] || ""),
    title: l?.title ?? "",
    description: l?.description ?? "",
    price_cents: l?.price_cents ?? (undefined as unknown as number),
    duration_minutes: l?.duration_minutes ?? null,
    location_mode: l?.location_mode ?? null,
    area_id: l?.area_id ?? null,
    travel_area_ids: saved.value?.travelAreaIds ?? [],
    address: a
      ? {
          line1: a.line1,
          line2: a.line2 ?? "",
          city: a.city,
          state: a.state,
          postal_code: a.postal_code,
          instructions: a.instructions ?? "",
        }
      : emptyAddress(),
  };
}

const { handleSubmit, isSubmitting, resetForm, setFieldValue, values, meta } = useForm<ListingInput>({
  validationSchema: zodSchema(listingSchema),
  initialValues: formValues(),
});

// ---------------------------------------------------------------------------
// Live updates (docs/design/notifications.md, "The editor")
// ---------------------------------------------------------------------------

// The saved record refreshes on tab focus and when a notification names this
// listing. The form only follows it when it has no unsaved changes; otherwise
// it keeps the provider's values and says what changed.
if (props.listingId) useLiveData({ refresh: () => refreshSaved(), listings: () => [props.listingId] });

const changedElsewhere = ref<null | "fields" | "locked">(null);
let refreshingOwn = false;
let lastSnapshot = JSON.stringify(formValues());
let lastStatus = status.value;
// Sync, so a refresh after the provider's own save (refreshOwn) is recognised.
watch(saved, () => {
  const snapshot = JSON.stringify(formValues());
  const statusChanged = status.value !== lastStatus;
  const fieldsChanged = snapshot !== lastSnapshot;
  lastSnapshot = snapshot;
  lastStatus = status.value;
  if (refreshingOwn || (!statusChanged && !fieldsChanged)) return;
  if (!meta.value.dirty) {
    resetForm({ values: formValues() });
    changedElsewhere.value = null;
    return;
  }
  const locked = !editable.value && !priceAndDescriptionEditable.value;
  changedElsewhere.value = locked ? "locked" : fieldsChanged ? "fields" : null;
}, { flush: "sync" });

async function refreshOwn() {
  refreshingOwn = true;
  try {
    await refreshSaved();
  } finally {
    refreshingOwn = false;
  }
  lastSnapshot = JSON.stringify(formValues());
  lastStatus = status.value;
  changedElsewhere.value = null;
}

const changedElsewhereText = computed(() => {
  if (changedElsewhere.value === "fields") {
    return "This listing was changed somewhere else, for example in another tab. Saving will replace those changes with yours.";
  }
  if (changedElsewhere.value === "locked") {
    const what = status.value === "unpublished" ? "lokl took this listing down" : "This listing was sent for review";
    return `${what} while you were editing, so your changes can't be saved. Copy anything you want to keep before you leave this page.`;
  }
  return "";
});

const cityAreas = computed(() => (refs.value?.areas ?? []).filter((a) => a.city_id === values.city_id));
// Sessions use the saved city's time zone, not the unsaved form value.
const savedCity = computed(() => cities.value.find((c) => c.id === listing.value?.city_id) ?? null);
const cityName = computed(() => cities.value.find((c) => c.id === values.city_id)?.name ?? "your city");

// Plain-language explanations when a list has nothing to choose from.
const noCategoriesText = computed(() => `There are no ${kindWord.value} categories yet. Check back soon.`);
const noAreasText = computed(() => `There are no areas in ${cityName.value} yet. Check back soon.`);
const showAddress = computed(() => needsAddress(kind.value, values.location_mode ?? null));
const isMobileService = computed(() => kind.value === "service" && values.location_mode === "customer_location");

// The address only exists for listings that need one; keep what was typed
// if the provider switches back and forth.
let stashedAddress = formValues().address;
watch(showAddress, (show) => {
  if (!show) {
    stashedAddress = values.address;
    setFieldValue("address", null);
  } else if (!values.address) {
    setFieldValue("address", stashedAddress ?? emptyAddress());
  }
}, { immediate: true });

// Travel areas, as a group of checkboxes over one array field.
const { value: travelAreaIds, errorMessage: travelAreaError } = useField<string[]>("travel_area_ids");
function toggleTravelArea(id: string, on: boolean) {
  const set = new Set(travelAreaIds.value ?? []);
  if (on) set.add(id);
  else set.delete(id);
  travelAreaIds.value = [...set];
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

let skipLeaveGuard = false;

async function run<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

const save = handleSubmit(async (v) => {
  try {
    let id = props.listingId;
    const fields = {
      category_id: v.category_id,
      city_id: v.city_id,
      title: v.title,
      description: v.description,
      price_cents: v.price_cents,
      duration_minutes: v.duration_minutes ?? null,
      location_mode: kind.value === "service" ? v.location_mode : null,
      area_id: showAddress.value ? v.area_id : null,
    };

    if (!id) {
      const created = await run(
        supabase
          .from("listings")
          .insert({ ...fields, provider_id: provider.value!.id, kind: kind.value })
          .select("id")
          .single(),
      );
      id = (created as { id: string }).id;
    } else if (status.value === "live") {
      await run(supabase.from("listings").update({ price_cents: fields.price_cents, description: fields.description }).eq("id", id));
    } else if (editable.value) {
      await run(supabase.from("listings").update(fields).eq("id", id));
    }

    if (editable.value || !props.listingId) {
      if (showAddress.value && v.address) {
        await run(supabase.from("listing_addresses").upsert({ listing_id: id, ...v.address }));
      } else if (saved.value?.address) {
        await run(supabase.from("listing_addresses").delete().eq("listing_id", id));
      }
    }

    if (kind.value === "service" && (travelAreasEditable.value || !props.listingId)) {
      const want = isMobileService.value ? v.travel_area_ids : [];
      const have = saved.value?.travelAreaIds ?? [];
      const add = want.filter((a) => !have.includes(a));
      const remove = have.filter((a) => !want.includes(a));
      // Add before removing, so a live Service never drops to zero areas.
      if (add.length) {
        await run(supabase.from("listing_service_areas").insert(add.map((a) => ({ listing_id: id, service_area_id: a }))));
      }
      if (remove.length) {
        await run(supabase.from("listing_service_areas").delete().eq("listing_id", id).in("service_area_id", remove));
      }
    }

    useSonner.success(props.listingId ? "Changes saved." : "Draft saved.");
    if (!props.listingId) {
      skipLeaveGuard = true;
      await navigateTo(`/dashboard/listings/${id}`, { replace: true });
      return;
    }
    await refreshOwn();
    resetForm({ values: formValues() });
  } catch (e) {
    useSonner.error(`That didn't save: ${(e as Error).message}`);
  }
});

// Warn before leaving with unsaved changes (in-app navigation and tab close).
onBeforeRouteLeave(() => {
  if (!skipLeaveGuard && meta.value.dirty) {
    return window.confirm("You have unsaved changes. Leave without saving them?");
  }
});
useEventListener("beforeunload", (e: BeforeUnloadEvent) => {
  if (meta.value.dirty) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Readiness and actions (from what's saved, as the server sees it)
// ---------------------------------------------------------------------------

const readiness = computed(() =>
  listingReadiness({
    kind: kind.value,
    status: status.value,
    locationMode: listing.value?.location_mode ?? null,
    hasAddress: !!saved.value?.address,
    travelAreaCount: saved.value?.travelAreaIds.length ?? 0,
    photoCount: saved.value?.photoCount ?? 0,
    upcomingSessionCount: saved.value?.upcomingSessionCount ?? 0,
    providerActive: provider.value?.status === "active",
    payoutsReady: !!provider.value && payoutSetupOf(provider.value) === "ready",
  }),
);
const canUnlist = computed(() => status.value === "live" || status.value === "submitted");
const canDelete = computed(() => !!listing.value && !listing.value.published_at);

const acting = ref(false);
const unlistOpen = ref(false);
const deleteOpen = ref(false);

async function act(action: "publish" | "submit" | "unlist") {
  acting.value = true;
  try {
    await $fetch(`/api/listings/${props.listingId}/${action}`, { method: "POST" });
    useSonner.success(
      {
        publish: "Your Service is live. Customers can find and book it now.",
        submit: "Sent to lokl for review. We'll let you know when it's approved.",
        unlist: "Unlisted. It's back to a draft and hidden from customers.",
      }[action],
    );
    await refreshOwn();
    resetForm({ values: formValues() });
  } catch (e) {
    useSonner.error((e as { statusMessage?: string }).statusMessage ?? "That didn't work. Please try again.");
  } finally {
    acting.value = false;
    unlistOpen.value = false;
  }
}

async function deleteDraft() {
  acting.value = true;
  const { error } = await supabase.from("listings").delete().eq("id", props.listingId!);
  acting.value = false;
  deleteOpen.value = false;
  if (error) return useSonner.error(`That didn't delete: ${error.message}`);
  // The photo rows went with the listing; remove their files too.
  const folder = `${listing.value!.provider_id}/${props.listingId}`;
  const { data: files } = await supabase.storage.from("listing-photos").list(folder);
  if (files?.length) await supabase.storage.from("listing-photos").remove(files.map((f) => `${folder}/${f.name}`));
  useSonner.success("Draft deleted.");
  skipLeaveGuard = true;
  await navigateTo(kind.value === "service" ? "/dashboard/services" : "/dashboard/experiences");
}

const statusNote = computed(() => {
  switch (status.value) {
    case "live":
      return "You can change the price and description. Unlist it to change anything else.";
    case "submitted":
      return "lokl is reviewing this Experience. You can't edit it until the review is done, or unlist it to make changes.";
    case "unpublished":
      return "lokl took this listing down, so it can't be edited. Contact lokl if you think this is a mistake.";
    default:
      return null;
  }
});
</script>

<template>
  <div class="pb-24 lg:pb-0">
    <UiAlert v-if="notFound" variant="destructive" class="max-w-lg">
      <UiAlertTitle>We couldn't find that listing</UiAlertTitle>
      <UiAlertDescription>
        It may have been deleted.
        <NuxtLink to="/dashboard" class="font-medium underline">Back to your dashboard</NuxtLink>
      </UiAlertDescription>
    </UiAlert>

    <UiAlert v-else-if="!provider" class="max-w-lg">
      <UiAlertTitle>Set up your business profile first</UiAlertTitle>
      <UiAlertDescription>
        <NuxtLink to="/dashboard/settings" class="font-medium underline">Go to your business profile</NuxtLink>
      </UiAlertDescription>
    </UiAlert>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ listing ? listing.title : `New ${kindWord}` }}
        </h1>
        <StatusBadge kind="listing" :status="status" />
      </div>

      <UiAlert v-if="status === 'rejected' && listing?.rejection_reason" variant="destructive" class="mt-4">
        <UiAlertTitle>lokl asked for changes</UiAlertTitle>
        <UiAlertDescription>{{ listing.rejection_reason }}</UiAlertDescription>
      </UiAlert>
      <UiAlert v-else-if="status === 'unpublished' && listing?.unpublished_reason" variant="destructive" class="mt-4">
        <UiAlertTitle>lokl took this listing down</UiAlertTitle>
        <UiAlertDescription>
          <p>{{ listing.unpublished_reason }}</p>
          <p class="mt-2">It can't be edited while it's down. Contact lokl if you have questions or think this is a mistake.</p>
        </UiAlertDescription>
      </UiAlert>
      <UiAlert v-else-if="statusNote" class="mt-4">
        <UiAlertDescription>{{ statusNote }}</UiAlertDescription>
      </UiAlert>
      <UiAlert v-if="changedElsewhere" variant="destructive" class="mt-4" icon="lucide:alert-triangle" role="status">
        <UiAlertTitle>{{ changedElsewhere === "locked" ? "Your changes can't be saved" : "Changed somewhere else" }}</UiAlertTitle>
        <UiAlertDescription>{{ changedElsewhereText }}</UiAlertDescription>
      </UiAlert>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <!-- The form (left column on desktop) -->
        <form id="listing-form" class="space-y-6" novalidate @submit="save">
          <UiCard>
            <UiCardHeader><UiCardTitle as="h2">About your {{ kindWord }}</UiCardTitle></UiCardHeader>
            <UiCardContent class="space-y-5">
              <UiVeeSelect name="category_id" label="Category" required :disabled="!editable || !categories.length"
                :hint="categories.length ? undefined : noCategoriesText">
                <option value="" disabled>{{ categories.length ? "Choose a category" : "No categories yet" }}</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </UiVeeSelect>
              <UiVeeInput name="title" label="Title" required :disabled="!editable" maxlength="100"
                :placeholder="kind === 'service' ? 'e.g. Silk press and trim' : 'e.g. Sweet Auburn food walk'" />
              <UiVeeTextarea name="description" label="Description" required rows="6" maxlength="5000"
                :disabled="!priceAndDescriptionEditable"
                :hint="`What's included, what to expect, anything to bring. ${values.description?.length ?? 0} of 5,000 characters.`" />
            </UiCardContent>
          </UiCard>

          <ListingPhotos v-if="listing" :listing-id="listing.id" :provider-id="listing.provider_id" :status="status"
            @changed="refreshSaved()" />
          <UiCard v-else>
            <UiCardHeader><UiCardTitle as="h2">Photos</UiCardTitle></UiCardHeader>
            <UiCardContent>
              <p class="text-muted-foreground text-sm">Save your draft first, then add photos.</p>
            </UiCardContent>
          </UiCard>

          <template v-if="kind === 'experience'">
            <ListingSessions v-if="listing && savedCity" :listing-id="listing.id" :status="status"
              :city-name="savedCity.name" :time-zone="savedCity.timezone"
              :duration-minutes="listing.duration_minutes" @changed="refreshSaved()" />
            <UiCard v-else>
              <UiCardHeader><UiCardTitle as="h2">Sessions</UiCardTitle></UiCardHeader>
              <UiCardContent>
                <p class="text-muted-foreground text-sm">Save your draft first, then add sessions.</p>
              </UiCardContent>
            </UiCard>
          </template>

          <UiCard>
            <UiCardHeader><UiCardTitle as="h2">Price and time</UiCardTitle></UiCardHeader>
            <UiCardContent class="space-y-5">
              <MoneyInput name="price_cents" :label="kind === 'experience' ? 'Price per person' : 'Price'" required
                :disabled="!priceAndDescriptionEditable"
                hint="The full price the customer pays." />
              <UiVeeInput name="duration_minutes" type="number" inputmode="numeric" min="5" max="1440"
                :label="kind === 'experience' ? 'How long it lasts, in minutes' : 'How long it takes, in minutes (optional)'"
                :required="kind === 'experience'" :disabled="!editable" />
            </UiCardContent>
          </UiCard>

          <UiCard>
            <UiCardHeader><UiCardTitle as="h2">Location</UiCardTitle></UiCardHeader>
            <UiCardContent class="space-y-5">
              <UiVeeSelect v-if="cities.length > 1" name="city_id" label="City" required :disabled="!editable">
                <option v-for="c in cities" :key="c.id" :value="c.id">{{ c.name }}, {{ c.state }}</option>
              </UiVeeSelect>

              <UiVeeRadioGroup v-if="kind === 'service'" name="location_mode" label="Where does it happen?" required
                :disabled="!editable">
                <label v-for="opt in [
                  { value: 'provider_location', label: 'At my place', hint: 'Customers come to you.' },
                  { value: 'customer_location', label: 'I come to you', hint: 'You travel to the customer.' },
                ]" :key="opt.value" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md py-1">
                  <UiRadioGroupItem :value="opt.value" />
                  <span><span class="block text-sm font-medium">{{ opt.label }}</span>
                    <span class="text-muted-foreground block text-sm">{{ opt.hint }}</span></span>
                </label>
              </UiVeeRadioGroup>

              <template v-if="showAddress">
                <UiVeeSelect name="area_id" :label="kind === 'experience' ? 'Meeting area' : 'Area customers see'" required
                  :disabled="!editable || !cityAreas.length"
                  :hint="cityAreas.length ? 'Shown before booking, like the neighborhood.' : noAreasText">
                  <option :value="null" disabled>{{ cityAreas.length ? "Choose an area" : "No areas yet" }}</option>
                  <option v-for="a in cityAreas" :key="a.id" :value="a.id">{{ a.name }}</option>
                </UiVeeSelect>

                <fieldset class="space-y-4" :disabled="!editable">
                  <legend class="text-sm font-medium">
                    {{ kind === "experience" ? "Meeting address" : "Address" }}
                    <span class="text-muted-foreground block font-normal">Customers see this only after they book.</span>
                  </legend>
                  <UiVeeInput name="address.line1" label="Street address" required autocomplete="address-line1" />
                  <UiVeeInput name="address.line2" label="Apartment, suite or unit (optional)" autocomplete="address-line2" />
                  <div class="grid gap-4 sm:grid-cols-[1fr_6rem_8rem]">
                    <UiVeeInput name="address.city" label="City" required autocomplete="address-level2" />
                    <UiVeeInput name="address.state" label="State" required maxlength="2" autocomplete="address-level1" />
                    <UiVeeInput name="address.postal_code" label="Zip code" required inputmode="numeric" autocomplete="postal-code" />
                  </div>
                  <UiVeeTextarea name="address.instructions" label="Arrival notes (optional)" rows="2"
                    hint='For example, "Side entrance, ring twice".' />
                </fieldset>
              </template>

              <fieldset v-if="isMobileService" class="space-y-1" :disabled="!travelAreasEditable"
                :aria-describedby="travelAreaError ? 'travel-areas-error' : undefined">
                <legend class="mb-2 text-sm font-medium">
                  Where you travel <span class="text-destructive">*</span>
                  <span class="text-muted-foreground block font-normal">Choose every area you'll go to.</span>
                </legend>
                <p v-if="!cityAreas.length" class="text-muted-foreground text-sm">{{ noAreasText }}</p>
                <label v-for="a in cityAreas" :key="a.id" class="flex min-h-11 cursor-pointer items-center gap-3">
                  <UiCheckbox :model-value="(travelAreaIds ?? []).includes(a.id)"
                    @update:model-value="(on: boolean | 'indeterminate') => toggleTravelArea(a.id, on === true)" />
                  <span class="text-sm">{{ a.name }}</span>
                </label>
                <p v-if="travelAreaError" id="travel-areas-error" class="text-destructive text-sm">{{ travelAreaError }}</p>
              </fieldset>
            </UiCardContent>
          </UiCard>
        </form>

        <!-- Readiness and actions. After the form in the page, so on phones it
             sits right above the Publish or Submit button; a sidebar on desktop. -->
        <UiCard class="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <UiCardHeader>
            <UiCardTitle as="h2">
              {{ readiness.action === "publish" ? "Ready to publish?" : "Ready to send for review?" }}
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <ul class="space-y-2 text-sm">
              <li v-if="!listing" class="flex gap-2">
                <Icon name="lucide:circle" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Save your draft first</span>
              </li>
              <li v-for="item in listing ? readiness.items : []" :key="item.key" class="flex gap-2">
                <Icon :name="item.done ? 'lucide:circle-check' : 'lucide:circle'" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  <span class="sr-only">{{ item.done ? "Done:" : "To do:" }}</span>
                  <NuxtLink v-if="!item.done && item.key === 'payouts'" to="/dashboard/payouts" class="underline">{{ item.label }}</NuxtLink>
                  <template v-else>{{ item.label }}</template>
                </span>
              </li>
            </ul>
            <p v-if="listing && meta.dirty && !canUnlist" class="text-muted-foreground text-sm">
              Save your changes first.
            </p>

            <UiButton v-if="listing && (status === 'draft' || status === 'rejected')" class="w-full"
              :disabled="!readiness.canAct || meta.dirty || acting" @click="act(readiness.action)">
              {{ readiness.action === "publish" ? "Publish your Service" : "Submit for review" }}
            </UiButton>
            <UiButton v-if="canUnlist" variant="outline" class="w-full" :disabled="acting" @click="unlistOpen = true">
              Unlist
            </UiButton>

            <UiButton type="submit" form="listing-form" variant="secondary" class="hidden w-full lg:inline-flex"
              :disabled="isSubmitting || status === 'submitted' || status === 'unpublished'">
              {{ isSubmitting ? "Saving…" : !listing || status === "draft" ? "Save draft" : "Save changes" }}
            </UiButton>
            <UiButton v-if="canDelete && (status === 'draft' || status === 'rejected')" variant="ghost"
              class="text-destructive w-full" :disabled="acting" @click="deleteOpen = true">
              Delete draft
            </UiButton>
          </UiCardContent>
        </UiCard>
      </div>

      <!-- Save, always in reach on phones -->
      <div class="border-border bg-card fixed inset-x-0 bottom-0 z-10 border-t p-3 lg:hidden">
        <UiButton type="submit" form="listing-form" class="w-full"
          :disabled="isSubmitting || status === 'submitted' || status === 'unpublished'">
          {{ isSubmitting ? "Saving…" : !listing || status === "draft" ? "Save draft" : "Save changes" }}
        </UiButton>
      </div>

      <UiAlertDialog v-model:open="unlistOpen"
        title="Unlist this listing?"
        :description="status === 'live'
          ? 'Customers won\'t be able to find or book it. It goes back to a draft, and you can publish it again later.'
          : 'It will leave lokl\'s review queue and go back to a draft. You can submit it again later.'">
        <template #footer>
          <UiAlertDialogFooter>
            <UiAlertDialogCancel text="Keep it listed" />
            <UiAlertDialogAction text="Unlist" :disabled="acting" @click.prevent="act('unlist')" />
          </UiAlertDialogFooter>
        </template>
      </UiAlertDialog>

      <UiAlertDialog v-model:open="deleteOpen" title="Delete this draft?"
        description="It will be removed for good, with its photos, address and travel areas. This can't be undone.">
        <template #footer>
          <UiAlertDialogFooter>
            <UiAlertDialogCancel text="Keep draft" />
            <UiAlertDialogAction text="Delete draft" variant="destructive" :disabled="acting" @click.prevent="deleteDraft()" />
          </UiAlertDialogFooter>
        </template>
      </UiAlertDialog>
    </template>
  </div>
</template>
