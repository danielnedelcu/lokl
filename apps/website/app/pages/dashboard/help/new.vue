<script setup lang="ts">
import {
  SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, marketZone, supportRefusalText, supportReportSchema,
  type SupportCategory, type SupportReportInput,
} from "@repo/types";

// "Report a problem" (docs/design/problem-reports.md, The form). The 911
// line is always at the top, not only once Safety is chosen. The website
// route sends it as the provider (the database checks the listing and
// booking are theirs, and the limits), then emails lokl at once.
definePageMeta({ layout: "dashboard", middleware: "provider-only" });
useSeoMeta({ title: "Report a problem" });

const supabase = useSupabaseClient();
const route = useRoute();
const { data: provider } = await useProvider();
const supportEmail = useRuntimeConfig().public.supportEmail;

// "Start a new report about this": the earlier report's category, listing
// and booking filled in, and the new one linked to it.
const followsId = typeof route.query.follows === "string" ? route.query.follows : null;
const { data: follows } = await useAsyncData(`support-follows-${followsId}`, async () => {
  if (!followsId) return null;
  const { data } = await supabase.from("support_reports")
    .select("id, category, listing_id, booking_id, created_at").eq("id", followsId).maybeSingle();
  return data;
});

// Their own listings, by title ("None" first).
const { data: listings } = await useAsyncData("support-listings", async () => {
  if (!provider.value) return [];
  // bounded: one provider's own listings
  const { data } = await supabase.from("listings").select("id, title").eq("provider_id", provider.value.id).order("title");
  return data ?? [];
});
const listingOptions = computed(() => [{ value: null, label: "None" }, ...(listings.value ?? []).map((l) => ({ value: l.id, label: l.title }))]);

const { handleSubmit, isSubmitting, setFieldValue, values } = useForm<SupportReportInput>({
  validationSchema: zodSchema(supportReportSchema),
  initialValues: {
    category: (follows.value?.category as SupportCategory | undefined) ?? undefined,
    description: "",
    listingId: follows.value?.listing_id ?? null,
    bookingId: follows.value?.booking_id ?? null,
    followsReportId: follows.value?.id ?? null,
  },
});

// Their bookings, searched on the server by the customer's name, newest
// first: "Sat, Oct 18, 10:00 AM (Atlanta time), Jordan".
interface BookingOption { id: string; starts_at: string | null; customer_name: string; listing_id: string; listing: { title: string; city: { name: string; timezone: string } | null } | null }
const bookingLabel = (b: BookingOption) => {
  const city = b.listing?.city;
  const zone = marketZone(city, "a provider's booking");
  const when = b.starts_at ? `${bookingAt(b.starts_at, zone)}${city ? ` (${city.name} time)` : ""}, ` : "";
  return `${when}${b.customer_name}`;
};
const bookingListing = new Map<string, string>();
async function searchBookings(term: string, signal: AbortSignal) {
  if (!provider.value) return [];
  // ilike's own wildcards (and PostgREST's *) match literally.
  const pattern = `%${term.trim().replace(/[\\%_]/g, "\\$&").replace(/\*/g, "")}%`;
  const { data, error } = await supabase.from("bookings")
    .select("id, starts_at, customer_name, listing_id, listing:listings(title, city:cities(name, timezone))")
    .eq("provider_id", provider.value.id).neq("status", "pending_payment").ilike("customer_name", pattern)
    .order("starts_at", { ascending: false, nullsFirst: false }).limit(20)
    .abortSignal(signal);
  if (error) throw new Error(error.message);
  return (data as unknown as BookingOption[]).map((b) => {
    bookingListing.set(b.id, b.listing_id);
    return { value: b.id, label: bookingLabel(b), description: b.listing?.title };
  });
}
// The chosen booking named after a reload (a follow-on report).
const bookingSelected = ref<string | undefined>();
if (follows.value?.booking_id) {
  const { data } = await supabase.from("bookings")
    .select("id, starts_at, customer_name, listing_id, listing:listings(title, city:cities(name, timezone))")
    .eq("id", follows.value.booking_id).maybeSingle();
  if (data) bookingSelected.value = bookingLabel(data as unknown as BookingOption);
}
const { value: bookingId, errorMessage: bookingError } = useField<string | null | undefined>("bookingId");
// Choosing a booking fills in its listing.
watch(bookingId, (id) => {
  const listing = id ? bookingListing.get(id) : undefined;
  if (listing) setFieldValue("listingId", listing);
});

const problem = ref("");
const send = handleSubmit(async (v) => {
  problem.value = "";
  try {
    const { id } = await $fetch<{ id: string }>("/api/provider/support-reports", { method: "POST", body: v });
    useSonner.success(v.category === "safety" ? "We've got your report and we've told the team now." : "We've got your report. We'll reply here.");
    await navigateTo(`/dashboard/help/${id}`);
  } catch (e) {
    problem.value = supportRefusalText((e as { statusMessage?: string }).statusMessage ?? "That didn't go through. Please try again.", supportEmail);
    await nextTick();
    document.getElementById("report-problem")?.focus();
  }
});
</script>

<template>
  <div class="max-w-2xl">
    <NuxtLink to="/dashboard/help" class="link-secondary text-sm">Back to Help</NuxtLink>
    <h1 class="mt-2 text-2xl font-semibold tracking-tight">Report a problem</h1>
    <p class="mt-1 text-sm text-muted-foreground">Tell us what's wrong. We'll reply on the report's page, and email you when we do.</p>

    <UiAlert variant="destructive" icon="lucide:siren" class="mt-6">
      <UiAlertTitle as="h2">If anyone is in danger, call 911 first</UiAlertTitle>
      <UiAlertDescription>Then tell us here.</UiAlertDescription>
    </UiAlert>

    <p v-if="follows" class="mt-6 text-sm">
      This follows on from <NuxtLink :to="`/dashboard/help/${follows.id}`" class="link-text">your report of {{ formatHomeDate(follows.created_at) }}</NuxtLink>.
    </p>

    <form class="mt-6 space-y-6" novalidate @submit="send">
      <UiVeeRadioGroup name="category" label="What's it about?" required>
        <label v-for="c in SUPPORT_CATEGORIES" :key="c" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md py-1">
          <UiRadioGroupItem :value="c" />
          <span class="text-sm font-medium">{{ SUPPORT_CATEGORY_LABELS[c] }}</span>
        </label>
      </UiVeeRadioGroup>

      <UiVeeTextarea name="description" label="What happened?" required :rows="6" maxlength="5000"
        hint="What happened, when, and what you'd like us to do." />

      <UiVeeSelect name="listingId" label="Which listing? (optional)" touch :options="listingOptions" placeholder="None" />

      <div>
        <UiLabel for="report-booking" class="mb-2">Which booking? (optional)</UiLabel>
        <SearchSelect id="report-booking" v-model="bookingId" placeholder="Type a customer's name" empty-text="No booking matches."
          :options="[{ value: null, label: 'None' }]" :search="searchBookings" :selected-label="bookingSelected"
          describedby="report-booking-hint" />
        <p id="report-booking-hint" class="mt-1.5 text-sm text-muted-foreground">Choosing a booking fills in its listing.</p>
        <p v-if="bookingError" class="mt-1.5 text-sm text-destructive">{{ bookingError }}</p>
      </div>

      <p v-if="problem" id="report-problem" role="alert" tabindex="-1" class="rounded-md border border-destructive p-3 text-sm text-destructive outline-none">
        {{ problem }}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <UiButton type="submit" :disabled="isSubmitting">{{ isSubmitting ? "Sending…" : "Send report" }}</UiButton>
        <p v-if="values.category === 'safety'" class="text-sm">Safety reports go to the whole team straight away.</p>
      </div>
    </form>
  </div>
</template>
