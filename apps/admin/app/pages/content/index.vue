<script setup lang="ts">
import { guideState, newGuideSchema, type Guide } from "@repo/types";

// Every destination guide, drafts included (docs/design/destination-guides.md,
// What the admin app needs). "New guide" asks for a title and web address,
// then opens the editor.
useHead({ title: "Destination guides" });
const supabase = useSupabaseClient();

type Row = Guide & { market: { name: string } | null };
const { data: rows, error, pending } = await useAsyncData("admin-guides", async () => {
  const { data, error } = await supabase.from("guides").select("*, market:cities(name)").order("updated_at", { ascending: false });
  if (error) throw error;
  return data as unknown as Row[];
});
watch(error, (e) => e && reportProblem("Couldn't load guides", e), { immediate: true });

const { data: markets } = await useAsyncData("admin-guide-markets", async () => {
  const { data, error } = await supabase.from("cities").select("id, name").eq("active", true).order("sort_order").order("name");
  if (error) throw error;
  return data;
});

// AI drafting this month (the cost log, guide_ai_drafts), in the viewer's time zone.
const { data: aiMonth } = await useAsyncData("admin-guide-ai-month", async () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data, error } = await supabase.from("guide_ai_drafts").select("cost_usd").gte("created_at", monthStart);
  if (error) {
    reportProblem("Couldn't load this month's AI drafting cost", error);
    return null;
  }
  return { count: data.length, cents: Math.round(data.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0) * 100) };
});

const columns = [
  { id: "title", header: "Title", accessorFn: (r: Row) => r.draft_title || r.title || "Untitled guide" },
  { id: "market", header: "City", accessorFn: (r: Row) => r.market?.name ?? "" },
  { id: "state", header: "Status", accessorFn: (r: Row) => guideState(r) },
  { accessorKey: "updated_at", header: "Last edited" },
];

// ---------------------------------------------------------------------------
// New guide
// ---------------------------------------------------------------------------

const newOpen = ref(false);
const marketId = ref("");
const form = useForm<{ title: string; slug: string }>({ validationSchema: zodSchema(newGuideSchema) });
// The address follows the title until it's edited by hand.
const slugEdited = ref(false);
watch(() => form.values.title, (t) => {
  if (!slugEdited.value) form.setFieldValue("slug", slugify(t ?? "").slice(0, 80).replace(/-+$/, ""));
});
function openNew() {
  form.resetForm({ values: { title: "", slug: "" } });
  slugEdited.value = false;
  marketId.value = markets.value?.[0]?.id ?? "";
  newOpen.value = true;
}
const create = form.handleSubmit(async ({ title, slug }) => {
  if (!marketId.value) return void useSonner.error("Add a city first (Cities), then create a guide for it.");
  const { data, error: e } = await supabase
    .from("guides")
    .insert({ market_id: marketId.value, slug, draft_title: title })
    .select("id")
    .single();
  if (e?.code === "23505") return void form.setFieldError("slug", "Another guide already uses this address. Choose a different one.");
  if (e) return void useSonner.error(reportProblem("The guide wasn't created. Try again.", e));
  newOpen.value = false;
  await navigateTo(`/content/${data.id}`);
});
</script>

<template>
  <div>
    <PageHeader title="Destination guides"
      description="Articles about places and themes in each city, each showing matching live listings.">
      <template #actions>
        <UiButton size="sm" @click="openNew">
          <Icon name="lucide:plus" aria-hidden="true" />New guide
        </UiButton>
      </template>
    </PageHeader>

    <p v-if="aiMonth?.count" class="text-muted-foreground mb-4 flex items-center gap-1 text-sm">
      <Icon name="lucide:sparkles" aria-hidden="true" />
      AI drafting this month: {{ formatMoney(aiMonth.cents) }} ({{ aiMonth.count }} {{ aiMonth.count === 1 ? "draft" : "drafts" }})
    </p>

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load guides</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!pending && !rows?.length" icon="lucide:map" title="No guides yet"
      description="Guides lead readers to bookable listings in the same area or category. Start with “New guide”." />
    <UiCard v-else class="py-0">
      <UiTanStackTable :data="rows ?? []" :columns="columns" :loading="pending">
        <template #title-cell="{ row }">
          <NuxtLink :to="`/content/${row.original.id}`" class="font-medium underline-offset-4 hover:underline">
            {{ row.original.draft_title || row.original.title || "Untitled guide" }}
          </NuxtLink>
        </template>
        <template #state-cell="{ row }">
          <StatusBadge kind="guide" :status="guideState(row.original)" />
        </template>
        <template #updated_at-cell="{ row }">
          <span class="text-muted-foreground">{{ formatDate(row.original.updated_at) }}</span>
        </template>
      </UiTanStackTable>
    </UiCard>

    <UiDialog v-model:open="newOpen">
      <UiDialogContent title="New guide" description="You can change the title later. The web address is fixed once the guide is published.">
        <template #content>
          <form id="new-guide" class="space-y-4" novalidate @submit="create">
            <div v-if="(markets?.length ?? 0) > 1">
              <UiLabel for="new-guide-market" class="mb-2">City</UiLabel>
              <SelectInput id="new-guide-market" v-model="marketId" :options="(markets ?? []).map((m) => ({ value: m.id, label: m.name }))" />
            </div>
            <UiVeeInput name="title" label="Title" required placeholder="Murals of the Eastside Trail" />
            <UiVeeInput name="slug" label="Web address" required hint="Lowercase letters, numbers and hyphens."
              @input="slugEdited = true" />
          </form>
        </template>
        <template #footer>
          <UiDialogFooter>
            <UiButton variant="outline" @click="newOpen = false">Cancel</UiButton>
            <UiButton type="submit" form="new-guide" :disabled="form.isSubmitting.value">
              {{ form.isSubmitting.value ? "Creating…" : "Create and open the editor" }}
            </UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
