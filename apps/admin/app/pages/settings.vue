<script setup lang="ts">
import { z } from "zod";

// Settings: commission rates per kind (docs/design/booking-and-checkout.md,
// Admin). Written from here under the database's admin-only rule
// (commission_rates_update_admin); each change is recorded, with who and
// when, by a trigger (commission_rate_changes). A new rate applies to
// bookings made after it; every booking keeps the rate it was made with.
useHead({ title: "Settings · Admin" });
const supabase = useSupabaseClient();
const user = useSupabaseUser();

const { data, error, refresh } = await useAsyncData("admin-settings", async () => {
  const [rates, history] = await Promise.all([
    supabase.from("commission_rates").select("kind, rate_bps, updated_at"),
    supabase.from("commission_rate_changes").select("id, kind, old_rate_bps, new_rate_bps, changed_by, changed_at").order("changed_at", { ascending: false }).limit(50),
  ]);
  if (rates.error) throw rates.error;
  if (history.error) throw history.error;
  return { rates: rates.data ?? [], history: history.data ?? [] };
});
watch(error, (e) => e && reportProblem("Couldn't load settings", e), { immediate: true });
const rateOf = (kind: string) => data.value?.rates.find((r) => r.kind === kind)?.rate_bps ?? 0;

const percent = z.coerce.number({ message: "Enter a percentage." }).min(0, "At least 0%.").max(50, "At most 50%.")
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most two decimal places.");
const { handleSubmit, resetForm, meta } = useForm<{ service: string | number; experience: string | number }>({
  validationSchema: zodSchema(z.object({ service: percent, experience: percent })),
});
watch(data, () => resetForm({ values: { service: rateOf("service") / 100, experience: rateOf("experience") / 100 } }), { immediate: true });

const saving = ref(false);
const save = handleSubmit(async (v) => {
  saving.value = true;
  try {
    for (const kind of ["service", "experience"] as const) {
      const bps = Math.round(Number(v[kind]) * 100);
      if (bps === rateOf(kind)) continue;
      const { error: e } = await supabase.from("commission_rates").update({ rate_bps: bps }).eq("kind", kind);
      if (e) throw e;
    }
    useSonner.success("Commission rates saved. They apply to new bookings.");
  } catch (e) {
    useSonner.error(reportProblem("The commission rates weren't saved. Try again.", e));
  } finally {
    saving.value = false;
    await refresh();
  }
});
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
</script>

<template>
  <div class="max-w-2xl">
    <PageHeader title="Settings" description="Platform-wide configuration." />
    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load settings</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>

    <section v-else-if="data" class="rounded-lg border border-border bg-card p-5" aria-labelledby="rates-heading">
      <h2 id="rates-heading" class="font-medium">Commission rates</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        lokl's share of each booking. The provider receives the rest; lokl pays Stripe's fee from its share. A change
        applies to bookings made after it; existing bookings keep their rate.
      </p>
      <form class="mt-4 grid gap-4 sm:grid-cols-2" novalidate @submit="save">
        <UiVeeInput name="service" type="number" inputmode="decimal" step="0.01" min="0" max="50" label="Services (%)" required />
        <UiVeeInput name="experience" type="number" inputmode="decimal" step="0.01" min="0" max="50" label="Experiences (%)" required />
        <div class="sm:col-span-2">
          <UiButton type="submit" :disabled="saving || !meta.dirty">{{ saving ? "Saving…" : "Save rates" }}</UiButton>
        </div>
      </form>

      <h3 class="mt-6 text-sm font-medium">History</h3>
      <p v-if="!data.history.length" class="mt-1 text-sm text-muted-foreground">No changes yet. Services started at 12% and Experiences at 20%.</p>
      <ul v-else class="mt-1 space-y-1 text-sm">
        <li v-for="h in data.history" :key="h.id">
          {{ formatDate(h.changed_at) }} · {{ h.kind === "service" ? "Services" : "Experiences" }}: {{ pct(h.old_rate_bps) }} → {{ pct(h.new_rate_bps) }}
          · {{ h.changed_by === user?.sub ? "by you" : "by another admin" }}
        </li>
      </ul>
    </section>
    <section v-if="data" class="mt-4 rounded-lg border border-border bg-card p-5">
      <h2 class="font-medium">Stripe Connect</h2>
      <p class="mt-1 text-sm text-muted-foreground">Platform account and webhook status.</p>
    </section>
  </div>
</template>
