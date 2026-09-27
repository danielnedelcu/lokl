<script setup lang="ts">
import { categorySchema, type Category, type CategoryInput } from "@repo/types";

useHead({ title: "Categories · Admin" });

type Kind = Category["kind"];
const kinds: { value: Kind; label: string; plural: string }[] = [
  { value: "service", label: "Service", plural: "Services" },
  { value: "experience", label: "Experience", plural: "Experiences" },
];
const kindLabel = (k: Kind) => kinds.find((x) => x.value === k)!;

const supabase = useSupabaseClient();
const activeKind = ref<Kind>("service");

// Admin-only reference list: read and written from here under admin-only
// database rules (apps/admin/CLAUDE.md). The admin sees inactive rows too.
const { data: categories, error, pending, refresh } = await useAsyncData("admin-categories", async () => {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return data as Category[];
});

const ofKind = (k: Kind) => (categories.value ?? []).filter((c) => c.kind === k);

// Manual order, so columns don't sort; the arrows set the order instead.
const columns = [
  { id: "order", header: "Order", enableSorting: false },
  { accessorKey: "name", header: "Name", enableSorting: false },
  { accessorKey: "slug", header: "Slug", enableSorting: false },
  { accessorKey: "active", header: "Status", enableSorting: false },
  { id: "actions", header: "", enableSorting: false },
];

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

const dialogOpen = ref(false);
const editing = ref<Category | null>(null);
const slugEdited = ref(false);

const { handleSubmit, isSubmitting, resetForm, setFieldError, setFieldValue, values } = useForm<CategoryInput>({
  validationSchema: zodSchema(categorySchema),
});

function openCreate() {
  editing.value = null;
  slugEdited.value = false;
  resetForm({ values: { kind: activeKind.value, name: "", slug: "", description: "" } });
  dialogOpen.value = true;
}

function openEdit(category: Category) {
  editing.value = category;
  // An existing slug may already be in use in links, so it's never rewritten
  // automatically; the admin can still change it by hand.
  slugEdited.value = true;
  resetForm({
    values: {
      kind: category.kind,
      name: category.name,
      slug: category.slug,
      description: category.description ?? "",
    },
  });
  dialogOpen.value = true;
}

// New categories: the slug follows the name until the admin types their own.
watch(
  () => values.name,
  (name) => {
    if (!slugEdited.value) setFieldValue("slug", slugify(name ?? ""));
  },
);

const save = handleSubmit(async (input) => {
  const { kind, ...fields } = input;
  const { error } = editing.value
    ? await supabase.from("categories").update(fields).eq("id", editing.value.id)
    : await supabase.from("categories").insert({ ...fields, kind, sort_order: ofKind(kind).length });

  if (error?.code === "23505") {
    setFieldError("slug", `Another ${kindLabel(kind).label} category already uses this slug. Choose a different one.`);
    return;
  }
  if (error) {
    useSonner.error(`The category wasn't saved: ${error.message}`);
    return;
  }
  useSonner.success(editing.value ? "Category saved." : "Category added.");
  dialogOpen.value = false;
  await refresh();
});

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

const busy = ref(false);

async function toggleActive(category: Category) {
  busy.value = true;
  const { error } = await supabase.from("categories").update({ active: !category.active }).eq("id", category.id);
  busy.value = false;
  if (error) return useSonner.error(`That didn't work: ${error.message}`);
  useSonner.success(
    category.active
      ? `“${category.name}” is now inactive and hidden from the public site.`
      : `“${category.name}” is active again.`,
  );
  await refresh();
}

async function move(kind: Kind, index: number, direction: -1 | 1) {
  busy.value = true;
  try {
    await saveOrder(supabase, "categories", ofKind(kind), index, direction);
  } catch (e) {
    useSonner.error(`The new order wasn't saved: ${(e as Error).message}`);
  }
  busy.value = false;
  await refresh();
}
</script>

<template>
  <div>
    <PageHeader
      title="Categories"
      description="Service and Experience categories. Providers file each listing under one. Only admins can change these."
    >
      <template #actions>
        <UiButton size="sm" @click="openCreate">New {{ kindLabel(activeKind).label }} category</UiButton>
      </template>
    </PageHeader>

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load categories</UiAlertTitle>
      <UiAlertDescription>{{ error.message }}. Reload the page to try again.</UiAlertDescription>
    </UiAlert>

    <UiTabs v-else v-model="activeKind">
      <UiTabsList>
        <UiTabsTrigger v-for="k in kinds" :key="k.value" :value="k.value">
          {{ k.plural }} ({{ ofKind(k.value).length }})
        </UiTabsTrigger>
      </UiTabsList>

      <UiTabsContent v-for="k in kinds" :key="k.value" :value="k.value" class="mt-4">
        <EmptyState
          v-if="!pending && !ofKind(k.value).length"
          icon="lucide:tags"
          :title="`No ${k.label} categories yet`"
          :description="`Add the first one so providers can file their ${k.plural}.`"
        />
        <UiCard v-else class="py-0">
          <UiTanStackTable
            :data="ofKind(k.value)"
            :columns="columns"
            :loading="pending"
            :show-pagination="false"
            :show-rows-per-page="false"
            :show-page-info="false"
          >
            <template #order-cell="{ row }">
              <div class="flex gap-1">
                <UiButton
                  size="icon-sm"
                  variant="ghost"
                  :disabled="busy || row.index === 0"
                  :aria-label="`Move ${row.original.name} up`"
                  @click="move(k.value, row.index, -1)"
                >
                  <Icon name="lucide:arrow-up" aria-hidden="true" />
                </UiButton>
                <UiButton
                  size="icon-sm"
                  variant="ghost"
                  :disabled="busy || row.index === ofKind(k.value).length - 1"
                  :aria-label="`Move ${row.original.name} down`"
                  @click="move(k.value, row.index, 1)"
                >
                  <Icon name="lucide:arrow-down" aria-hidden="true" />
                </UiButton>
              </div>
            </template>
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}</span>
              <p v-if="row.original.description" class="text-muted-foreground max-w-md truncate text-xs">
                {{ row.original.description }}
              </p>
            </template>
            <template #slug-cell="{ row }">
              <code class="text-muted-foreground text-xs">{{ row.original.slug }}</code>
            </template>
            <template #active-cell="{ row }">
              <StatusBadge kind="record" :status="row.original.active ? 'active' : 'inactive'" />
            </template>
            <template #actions-cell="{ row }">
              <div class="flex justify-end gap-2">
                <UiButton size="sm" variant="outline" :aria-label="`Edit ${row.original.name}`" @click="openEdit(row.original)">
                  Edit
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  :aria-label="`${row.original.active ? 'Deactivate' : 'Reactivate'} ${row.original.name}`"
                  @click="toggleActive(row.original)"
                >
                  {{ row.original.active ? "Deactivate" : "Reactivate" }}
                </UiButton>
              </div>
            </template>
          </UiTanStackTable>
        </UiCard>
      </UiTabsContent>
    </UiTabs>

    <UiDialog v-model:open="dialogOpen">
      <UiDialogContent
        :title="editing ? `Edit ${kindLabel(editing.kind).label} category` : `New ${kindLabel(activeKind).label} category`"
        :description="editing ? 'Changes show on the public site right away.' : 'Providers can file listings under it once it exists.'"
      >
        <template #content>
          <form id="category-form" class="space-y-4" novalidate @submit="save">
            <UiVeeInput name="name" label="Name" required placeholder="e.g. Hair and beauty" />
            <UiVeeInput
              name="slug"
              label="Slug"
              required
              hint="Used in web addresses. Lowercase letters, numbers and hyphens."
              @input="slugEdited = true"
            />
            <UiVeeTextarea
              name="description"
              label="Description"
              hint="Optional. Shown on the category page later. Up to 500 characters."
              rows="3"
            />
          </form>
        </template>
        <template #footer>
          <UiDialogFooter>
            <UiButton variant="outline" @click="dialogOpen = false">Cancel</UiButton>
            <UiButton type="submit" form="category-form" :disabled="isSubmitting">
              {{ isSubmitting ? "Saving…" : editing ? "Save changes" : "Add category" }}
            </UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
