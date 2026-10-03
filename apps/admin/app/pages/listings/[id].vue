<script setup lang="ts">
import {
  listingReasonSchema,
  payoutSetupOf,
  reviewBlockers,
  type ListingKind,
  type ListingReasonInput,
  type ListingStatus,
  type Provider,
} from "@repo/types";

// One listing, with everything needed to review it, and the admin's status
// actions. Reads come from the page under admin RLS; the actions go through
// server routes (apps/admin/CLAUDE.md), which re-check everything.
const route = useRoute();
const id = computed(() => String(route.params.id));
const supabase = useSupabaseClient();

interface Detail {
  id: string;
  kind: ListingKind;
  status: ListingStatus;
  title: string;
  description: string;
  price_cents: number;
  duration_minutes: number | null;
  location_mode: "provider_location" | "customer_location" | null;
  rejection_reason: string | null;
  unpublished_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  provider: Provider;
  category: { name: string } | null;
  city: { name: string; state: string; timezone: string } | null;
  area: { name: string } | null;
}

const { data, error, pending, refresh } = await useAsyncData(`admin-listing-${id.value}`, async () => {
  // service_areas is linked to listings twice (the listing's own area_id, and
  // travel areas through listing_service_areas), so each embed names its
  // relationship.
  const [listing, address, photos, sessions, travel] = await Promise.all([
    supabase
      .from("listings")
      .select("*, provider:providers(*), category:categories(name), city:cities(name, state, timezone), area:service_areas!listings_area_id_fkey(name)")
      .eq("id", id.value)
      .maybeSingle(),
    supabase.from("listing_addresses").select("*").eq("listing_id", id.value).maybeSingle(),
    supabase.from("listing_photos").select("id, storage_path, alt_text, position").eq("listing_id", id.value).order("position"),
    supabase
      .from("experience_sessions")
      .select("id, starts_at, capacity")
      .eq("listing_id", id.value)
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at"),
    supabase.from("listing_service_areas").select("area:service_areas!listing_service_areas_service_area_id_fkey(name)").eq("listing_id", id.value),
  ]);
  for (const r of [listing, address, photos, sessions, travel]) if (r.error) throw r.error;
  return {
    listing: listing.data as unknown as Detail | null,
    address: address.data as { line1: string; line2: string | null; city: string; state: string; postal_code: string; instructions: string | null } | null,
    photos: (photos.data ?? []) as { id: string; storage_path: string; alt_text: string }[],
    sessions: (sessions.data ?? []) as { id: string; starts_at: string; capacity: number }[],
    travelAreas: ((travel.data ?? []) as unknown as { area: { name: string } | null }[]).map((t) => t.area?.name).filter(Boolean) as string[],
  };
});

const listing = computed(() => data.value?.listing ?? null);
// The provider may edit or unlist it meanwhile: refresh when the tab is back in view.
useLiveData({ refresh });
useHead({ title: () => `${listing.value?.title ?? "Listing"} · Admin` });

const kindWord = computed(() => (listing.value?.kind === "experience" ? "Experience" : "Service"));
const backTo = computed(() => (listing.value?.kind === "experience" ? "/listings/experiences" : "/listings/services"));
const timeZone = computed(() => listing.value?.city?.timezone ?? "America/New_York");
const photoUrl = (path: string) => supabase.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;

// The same checks the approve and restore routes run, so the buttons say
// up front why they're unavailable.
const blockers = computed(() => {
  const l = listing.value;
  if (!l) return [];
  return reviewBlockers({
    kind: l.kind,
    status: l.status,
    locationMode: l.location_mode,
    hasAddress: !!data.value?.address,
    travelAreaCount: data.value?.travelAreas.length ?? 0,
    photoCount: data.value?.photos.length ?? 0,
    upcomingSessionCount: data.value?.sessions.length ?? 0,
    providerActive: l.provider.status === "active",
    payoutsReady: payoutSetupOf(l.provider) === "ready",
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action = "approve" | "reject" | "unpublish" | "restore";
const busy = ref(false);
const confirmOpen = ref(false);
const reasonOpen = ref(false);
const pendingAction = ref<Action | null>(null);

const copy: Record<Action, { title: string; description: string; button: string; done: string }> = {
  approve: {
    title: "Approve this Experience?",
    description: "It goes live straight away, and customers can find and book it.",
    button: "Approve",
    done: "Approved. It's live now.",
  },
  restore: {
    title: "Restore this listing?",
    description: "It goes live again straight away, and the reason you gave is removed.",
    button: "Restore",
    done: "Restored. It's live again.",
  },
  reject: {
    title: "Send this Experience back?",
    description: "The provider sees your reason at the top of their editor. They can make changes and send it again.",
    button: "Send back",
    done: "Sent back to the provider.",
  },
  unpublish: {
    title: "Take this listing down?",
    description: "Customers can't find or book it any more. The provider sees your reason in their editor, and only you can put it back.",
    button: "Take down",
    done: "Taken down.",
  },
};

function ask(action: Action) {
  pendingAction.value = action;
  if (action === "reject" || action === "unpublish") {
    reasonForm.resetForm({ values: { reason: "" } });
    reasonOpen.value = true;
  } else {
    confirmOpen.value = true;
  }
}

async function run(action: Action, body?: ListingReasonInput) {
  busy.value = true;
  try {
    await $fetch(`/api/listings/${id.value}/${action}`, { method: "POST", body });
    useSonner.success(copy[action].done);
    confirmOpen.value = reasonOpen.value = false;
  } catch (e) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string };
    // The routes' messages are written for the admin; anything else is logged.
    useSonner.error(reportProblem(err.data?.statusMessage ?? "That didn't work. Try again, or check the server logs.", e));
  } finally {
    busy.value = false;
    await refresh();
  }
}

const reasonForm = useForm<ListingReasonInput>({ validationSchema: zodSchema(listingReasonSchema) });
const submitReason = reasonForm.handleSubmit((v) => run(pendingAction.value!, v));
watch(error, (e) => e && reportProblem("Couldn't load this listing", e), { immediate: true });
</script>

<template>
  <div>
    <UiButton variant="link" class="mb-2 px-0" :to="backTo">
      <Icon name="lucide:arrow-left" aria-hidden="true" /> Back to {{ kindWord }}s
    </UiButton>

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load this listing</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <EmptyState
      v-else-if="!pending && !listing"
      icon="lucide:search-x"
      title="Listing not found"
      description="It may have been deleted by its provider while it was still a draft."
    />

    <div v-else-if="listing" class="space-y-6">
      <PageHeader :title="listing.title" :description="`${kindWord} by ${listing.provider.display_name}`">
        <template #actions>
          <StatusBadge kind="listing" :status="listing.status" />
        </template>
      </PageHeader>

      <!-- Actions for the current status -->
      <UiCard>
        <UiCardHeader>
          <UiCardTitle as="h2">Review</UiCardTitle>
          <UiCardDescription>
            <template v-if="listing.status === 'submitted'">
              Sent for review {{ listing.submitted_at ? `${formatAge(listing.submitted_at)} ago` : "" }}.
            </template>
            <template v-else-if="listing.status === 'live'">Live since {{ formatDate(listing.published_at!, timeZone) }}.</template>
            <template v-else-if="listing.status === 'unpublished'">You took this listing down.</template>
            <template v-else-if="listing.status === 'rejected'">Sent back to the provider. It returns here if they send it again.</template>
            <template v-else>The provider is still writing this {{ kindWord.toLowerCase() }}. There's nothing to review yet.</template>
          </UiCardDescription>
        </UiCardHeader>
        <UiCardContent class="space-y-4">
          <UiAlert v-if="listing.status === 'rejected' && listing.rejection_reason">
            <UiAlertTitle>Your reason</UiAlertTitle>
            <UiAlertDescription>{{ listing.rejection_reason }}</UiAlertDescription>
          </UiAlert>
          <UiAlert v-if="listing.status === 'unpublished' && listing.unpublished_reason">
            <UiAlertTitle>Your reason</UiAlertTitle>
            <UiAlertDescription>{{ listing.unpublished_reason }}</UiAlertDescription>
          </UiAlert>

          <div v-if="['submitted', 'unpublished'].includes(listing.status) && blockers.length" id="blockers">
            <p class="text-sm font-medium">It can't go live yet:</p>
            <ul class="mt-1 list-inside list-disc text-sm">
              <li v-for="b in blockers" :key="b">{{ b }}</li>
            </ul>
          </div>

          <div class="flex flex-wrap gap-2">
            <template v-if="listing.status === 'submitted'">
              <UiButton :disabled="busy || !!blockers.length" :aria-describedby="blockers.length ? 'blockers' : undefined" @click="ask('approve')">
                Approve
              </UiButton>
              <UiButton variant="outline" :disabled="busy" @click="ask('reject')">Send back</UiButton>
            </template>
            <UiButton v-if="listing.status === 'live'" variant="destructive" :disabled="busy" @click="ask('unpublish')">
              Take down
            </UiButton>
            <UiButton v-if="listing.status === 'unpublished'" :disabled="busy || !!blockers.length"
              :aria-describedby="blockers.length ? 'blockers' : undefined" @click="ask('restore')">
              Restore
            </UiButton>
          </div>
        </UiCardContent>
      </UiCard>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          <UiCard>
            <UiCardHeader><UiCardTitle as="h2">Details</UiCardTitle></UiCardHeader>
            <UiCardContent>
              <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div><dt class="text-muted-foreground">Category</dt><dd>{{ listing.category?.name ?? "—" }}</dd></div>
                <div><dt class="text-muted-foreground">City</dt><dd>{{ listing.city ? `${listing.city.name}, ${listing.city.state}` : "—" }}</dd></div>
                <div>
                  <dt class="text-muted-foreground">{{ listing.kind === "experience" ? "Price per person" : "Price" }}</dt>
                  <dd>{{ formatMoney(listing.price_cents) }}</dd>
                </div>
                <div v-if="listing.duration_minutes">
                  <dt class="text-muted-foreground">Length</dt><dd>{{ listing.duration_minutes }} minutes</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Where</dt>
                  <dd>
                    <template v-if="listing.location_mode === 'customer_location'">
                      Travels to customers{{ data?.travelAreas.length ? `: ${data.travelAreas.join(", ")}` : "" }}
                    </template>
                    <template v-else>{{ listing.area?.name ?? "—" }}</template>
                  </dd>
                </div>
              </dl>
              <h3 class="mt-6 text-sm font-medium">Description</h3>
              <p class="mt-1 text-sm whitespace-pre-line">{{ listing.description }}</p>
            </UiCardContent>
          </UiCard>

          <UiCard>
            <UiCardHeader>
              <UiCardTitle as="h2">Photos ({{ data?.photos.length ?? 0 }})</UiCardTitle>
              <UiCardDescription>Check each description matches its photo.</UiCardDescription>
            </UiCardHeader>
            <UiCardContent>
              <p v-if="!data?.photos.length" class="text-muted-foreground text-sm">No photos.</p>
              <ul v-else class="grid gap-4 sm:grid-cols-2">
                <li v-for="(p, i) in data.photos" :key="p.id" class="overflow-hidden rounded-lg border">
                  <NuxtImg :src="photoUrl(p.storage_path)" :alt="p.alt_text" width="800" height="600"
                    class="aspect-[4/3] w-full object-cover" loading="lazy" />
                  <p class="p-3 text-sm"><span v-if="i === 0" class="font-medium">Cover: </span>{{ p.alt_text }}</p>
                </li>
              </ul>
            </UiCardContent>
          </UiCard>
        </div>

        <div class="space-y-6">
          <UiCard>
            <UiCardHeader><UiCardTitle as="h2">Provider</UiCardTitle></UiCardHeader>
            <UiCardContent class="space-y-3 text-sm">
              <p class="font-medium">{{ listing.provider.display_name }}</p>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-muted-foreground">Account</span>
                <StatusBadge kind="provider" :status="listing.provider.status" />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-muted-foreground">Payouts</span>
                <StatusBadge kind="payouts" :status="payoutSetupOf(listing.provider)" />
              </div>
            </UiCardContent>
          </UiCard>

          <UiCard v-if="listing.location_mode !== 'customer_location'">
            <UiCardHeader>
              <UiCardTitle as="h2">Address</UiCardTitle>
              <UiCardDescription>Private: only you and the provider see this. Customers see it after booking.</UiCardDescription>
            </UiCardHeader>
            <UiCardContent class="text-sm">
              <address v-if="data?.address" class="not-italic">
                {{ data.address.line1 }}<br>
                <template v-if="data.address.line2">{{ data.address.line2 }}<br></template>
                {{ data.address.city }}, {{ data.address.state }} {{ data.address.postal_code }}
              </address>
              <p v-else class="text-muted-foreground">No address yet.</p>
              <p v-if="data?.address?.instructions" class="text-muted-foreground mt-2">{{ data.address.instructions }}</p>
            </UiCardContent>
          </UiCard>

          <UiCard v-if="listing.kind === 'experience'">
            <UiCardHeader>
              <UiCardTitle as="h2">Upcoming sessions ({{ data?.sessions.length ?? 0 }})</UiCardTitle>
              <UiCardDescription v-if="listing.city">Times are {{ timeZoneLabel(listing.city.name, timeZone) }}.</UiCardDescription>
            </UiCardHeader>
            <UiCardContent class="text-sm">
              <p v-if="!data?.sessions.length" class="text-muted-foreground">
                None yet. It can still be approved; customers can book once sessions are added.
              </p>
              <ul v-else class="space-y-1">
                <li v-for="s in data.sessions" :key="s.id">
                  {{ formatSessionDate(s.starts_at, timeZone) }}, {{ formatSessionTime(s.starts_at, timeZone) }} ·
                  {{ s.capacity }} {{ s.capacity === 1 ? "spot" : "spots" }}
                </li>
              </ul>
            </UiCardContent>
          </UiCard>

          <ListingBookings :listing-id="id" />
        </div>
      </div>
    </div>

    <UiAlertDialog v-if="pendingAction" v-model:open="confirmOpen" :title="copy[pendingAction].title"
      :description="copy[pendingAction].description">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Cancel" />
          <UiAlertDialogAction :text="copy[pendingAction].button" :disabled="busy" @click.prevent="run(pendingAction)" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>

    <UiDialog v-model:open="reasonOpen">
      <UiDialogContent v-if="pendingAction" :title="copy[pendingAction].title" :description="copy[pendingAction].description">
        <template #content>
          <form id="reason-form" novalidate @submit="submitReason">
            <UiVeeTextarea name="reason" label="Reason for the provider" required :rows="4" maxlength="1000"
              :hint="pendingAction === 'reject'
                ? 'Say what to change, e.g. Add where to meet and what to bring.'
                : 'Say why, e.g. The photos show a different business.'" />
          </form>
        </template>
        <template #footer>
          <UiDialogFooter>
            <UiButton variant="outline" @click="reasonOpen = false">Cancel</UiButton>
            <UiButton type="submit" form="reason-form" :variant="pendingAction === 'unpublish' ? 'destructive' : 'default'" :disabled="busy">
              {{ busy ? "Saving…" : copy[pendingAction].button }}
            </UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
