<script setup lang="ts">
import { adminSettingsSchema, type AdminSettingsInput } from "@repo/types";

// Each save or action here first takes down the last message it showed (useSaveMessages).
const messages = useSaveMessages();
const supabase = useSupabaseClient();

// Support's limits (admin roles step 5d): the refund limit and the daily
// limits, changed through admin_update_settings() with a reason. The
// database logs what changed and tells every owner; it refuses support.
const { data: limits, error: limitsError, refresh: refreshLimits } = await useAsyncData("admin-settings-limits", async () => {
  const { data: row, error: e } = await supabase.from("admin_settings")
    .select("refund_limit_cents, support_refunds_per_day, support_refund_cents_per_day, support_contact_views_per_day, support_requests_per_day")
    .maybeSingle();
  if (e) throw e;
  return row;
});
watch(limitsError, (e) => e && reportProblem("Couldn't load support's limits", e), { immediate: true });
const { handleSubmit, resetForm, meta } = useForm<AdminSettingsInput>({ validationSchema: zodSchema(adminSettingsSchema) });
watch(limits, (l) => l && resetForm({ values: {
  refundLimitDollars: l.refund_limit_cents / 100,
  refundsPerDay: l.support_refunds_per_day,
  refundDollarsPerDay: l.support_refund_cents_per_day / 100,
  contactViewsPerDay: l.support_contact_views_per_day,
  requestsPerDay: l.support_requests_per_day,
  reason: "",
} }), { immediate: true });
const savingLimits = ref(false);
const saveLimitsSubmit = handleSubmit(async (v) => {
  savingLimits.value = true;
  try {
    const parsed = adminSettingsSchema.parse(v);
    const { error: e } = await supabase.rpc("admin_update_settings", {
      p_refund_limit_cents: Math.round(parsed.refundLimitDollars * 100),
      p_refunds_per_day: parsed.refundsPerDay,
      p_refund_cents_per_day: Math.round(parsed.refundDollarsPerDay * 100),
      p_contact_views_per_day: parsed.contactViewsPerDay,
      p_requests_per_day: parsed.requestsPerDay,
      p_reason: parsed.reason,
    });
    if (e) throw e;
    messages.success("Support's limits saved. The other owners are told.");
  } catch (e) {
    messages.error(reportProblem(problemText(e, "Support's limits weren't saved. Try again."), e));
  } finally {
    savingLimits.value = false;
    await refreshLimits();
  }
});
const saveLimits = (e?: Event) => {
  messages.start();
  return saveLimitsSubmit(e);
};
</script>

<template>
  <UiAlert v-if="limitsError" variant="destructive">
    <UiAlertTitle>Couldn't load support's limits</UiAlertTitle>
    <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
  </UiAlert>
  <section v-else-if="limits" class="rounded-lg border border-border bg-card p-5" aria-labelledby="limits-heading">
    <h2 id="limits-heading" class="font-medium">Support's limits</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Support refunds up to the refund limit of what's left of a charge; above it, they ask you. Each day (Atlanta
      time) they can make a set number of refunds, up to a total, see a set number of contact details, and send a set
      number of requests. Past a daily limit, they ask you instead. Every owner is told when these change.
    </p>
    <form class="mt-4 grid gap-4 sm:grid-cols-2" novalidate @submit="saveLimits">
      <UiVeeNumberField name="refundLimitDollars" :step="1" :min="0" :max="10000"
        :format-options="{ style: 'currency', currency: 'USD' }" label="Refund limit, each" required />
      <UiVeeNumberField name="refundsPerDay" :step="1" :min="0" :max="1000" label="Refunds a day" required />
      <UiVeeNumberField name="refundDollarsPerDay" :step="10" :min="0" :max="1000000"
        :format-options="{ style: 'currency', currency: 'USD' }" label="Refunds in all, a day" required />
      <UiVeeNumberField name="contactViewsPerDay" :step="1" :min="0" :max="10000" label="Contact details seen a day" required />
      <UiVeeNumberField name="requestsPerDay" :step="1" :min="0" :max="10000" label="Requests a day" required />
      <div class="sm:col-span-2">
        <UiVeeTextarea name="reason" label="Why you're changing them" required :rows="2" maxlength="1000"
          hint="Kept in the activity log. The other owners are told what changed." />
      </div>
      <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
        <UiButton type="submit" :disabled="savingLimits || !meta.dirty">{{ savingLimits ? "Saving…" : "Save limits" }}</UiButton>
        <NuxtLink to="/activity" class="text-sm underline underline-offset-4">Every change, on the Activity page</NuxtLink>
      </div>
    </form>
  </section>
</template>
