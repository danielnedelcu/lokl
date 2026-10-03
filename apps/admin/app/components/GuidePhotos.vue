<script setup lang="ts">
import {
  coverSizeProblem,
  guidePhotoColumns,
  guidePhotoDetailsSchema,
  photoCredit,
  GUIDE_PHOTO_BUCKET,
  GUIDE_PHOTO_MAX_BYTES,
  GUIDE_PHOTO_MAX_SIDE,
  type GuidePhoto,
  type GuidePhotoDetails,
} from "@repo/types";

// A guide's photos (docs/design/destination-guides.md, Photos and credits).
// Resized in the browser first (longest side 2,400px, WebP, location data
// removed), uploaded to the guide's own folder, then recorded with alt text
// and the credit its licence asks for. Any photo can go in the body; the
// cover has to be landscape and at least 1,600 × 900.
const props = defineProps<{
  guideId: string;
  photos: GuidePhoto[];
  coverId: string | null;
  /** Photos the published version uses (its cover, or its body while live): not deletable. */
  liveIds: Set<string>;
  /** Called after the admin confirms a delete; the page removes it from the draft too. */
  remove: (photo: GuidePhoto) => Promise<void>;
}>();
const emit = defineEmits<{ changed: []; cover: [id: string] }>();

const supabase = useSupabaseClient();
const publicUrl = (path: string) => supabase.storage.from(GUIDE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
const busy = ref(false);
const size = (p: { width: number; height: number }) => `${p.width.toLocaleString("en-US")} × ${p.height.toLocaleString("en-US")}`;

// ---------------------------------------------------------------------------
// The details form, for a new photo and for editing one
// ---------------------------------------------------------------------------

const blank: GuidePhotoDetails = {
  alt_text: "",
  source: "own",
  credit_name: "",
  credit_url: "",
  source_url: "",
  licence: "",
  commercial_use_confirmed: false,
};
const form = useForm<GuidePhotoDetails>({ validationSchema: zodSchema(guidePhotoDetailsSchema), initialValues: blank });
const source = computed(() => form.values.source);
const creditPreview = computed(() => photoCredit(guidePhotoColumns({ ...blank, ...form.values })));

// ---------------------------------------------------------------------------
// Adding: pick files -> prepare each -> describe it -> upload + record
// ---------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const queue = ref<File[]>([]);
const pending = ref<{ prepared: PreparedPhoto; previewUrl: string } | null>(null);
const addOpen = ref(false);

function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  queue.value = [...(input.files ?? [])];
  input.value = "";
  void nextInQueue();
}

async function nextInQueue() {
  const file = queue.value.shift();
  if (!file) return;
  try {
    const prepared = await prepareListingPhoto(file, { maxSide: GUIDE_PHOTO_MAX_SIDE, maxBytes: GUIDE_PHOTO_MAX_BYTES });
    pending.value = { prepared, previewUrl: URL.createObjectURL(prepared.blob) };
    form.resetForm({ values: { ...blank } });
    addOpen.value = true;
  } catch (e) {
    useSonner.error(e instanceof PhotoError ? `${file.name}: ${e.message}` : `${file.name} couldn't be added.`);
    void nextInQueue();
  }
}

function closeAdd() {
  if (pending.value) URL.revokeObjectURL(pending.value.previewUrl);
  pending.value = null;
  addOpen.value = false;
  void nextInQueue();
}

const upload = form.handleSubmit(async (values) => {
  if (!pending.value) return;
  const { prepared } = pending.value;
  const base = `${props.guideId}/${crypto.randomUUID()}`;
  const path = `${base}.${prepared.ext}`;
  const cardPath = `${base}.card.${prepared.cardExt}`;
  const uploaded: string[] = [];
  busy.value = true;
  try {
    const bucket = supabase.storage.from(GUIDE_PHOTO_BUCKET);
    const up = await bucket.upload(path, prepared.blob, { contentType: prepared.blob.type, upsert: false });
    if (up.error) throw up.error;
    uploaded.push(path);
    const card = await bucket.upload(cardPath, prepared.card, { contentType: prepared.card.type, upsert: false });
    if (card.error) throw card.error;
    uploaded.push(cardPath);
    // Width and height as the browser reports them (design: Photos and credits).
    const { error } = await supabase.from("guide_photos").insert({
      guide_id: props.guideId,
      storage_path: path,
      card_path: cardPath,
      width: prepared.width,
      height: prepared.height,
      ...guidePhotoColumns(values),
    });
    if (error) throw error;
    uploaded.length = 0;
    useSonner.success("Photo added.");
    emit("changed");
  } catch (e) {
    // Don't leave unused files behind.
    if (uploaded.length) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove(uploaded);
    useSonner.error(reportProblem("The photo wasn't added. Try again.", e));
  } finally {
    busy.value = false;
    closeAdd();
  }
});

// ---------------------------------------------------------------------------
// Editing details, removing
// ---------------------------------------------------------------------------

const editing = ref<GuidePhoto | null>(null);
const editOpen = ref(false);
function openEdit(photo: GuidePhoto) {
  editing.value = photo;
  form.resetForm({
    values: {
      alt_text: photo.alt_text,
      source: photo.source as GuidePhotoDetails["source"],
      credit_name: photo.credit_name ?? "",
      credit_url: photo.credit_url ?? "",
      source_url: photo.source_url ?? "",
      licence: photo.licence ?? "",
      commercial_use_confirmed: photo.commercial_use_confirmed,
    },
  });
  editOpen.value = true;
}
const saveEdit = form.handleSubmit(async (values) => {
  if (!editing.value) return;
  busy.value = true;
  const { error } = await supabase.from("guide_photos").update(guidePhotoColumns(values)).eq("id", editing.value.id);
  busy.value = false;
  if (error) return useSonner.error(reportProblem("The details weren't saved. Try again.", error));
  useSonner.success("Photo details saved.");
  editOpen.value = false;
  emit("changed");
});

const removing = ref<GuidePhoto | null>(null);
const removeOpen = ref(false);
function askRemove(photo: GuidePhoto) {
  removing.value = photo;
  removeOpen.value = true;
}
async function confirmRemove() {
  if (!removing.value) return;
  busy.value = true;
  try {
    await props.remove(removing.value);
    removeOpen.value = false;
  } finally {
    busy.value = false;
  }
}
const removeDescription = computed(() => {
  const p = removing.value;
  if (!p) return "";
  const parts = ["It will be deleted, and taken out of the draft wherever it's used. This can't be undone."];
  if (p.id === props.coverId) parts.push("It's the draft's cover, so the draft will need a new one.");
  return parts.join(" ");
});
</script>

<template>
  <section aria-labelledby="photos-heading" class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h2 id="photos-heading" class="font-medium">Photos</h2>
      <UiButton size="sm" variant="outline" :disabled="busy" @click="fileInput?.click()">
        <Icon name="lucide:image-plus" aria-hidden="true" />
        Add photos
      </UiButton>
    </div>
    <p class="text-muted-foreground text-sm">
      The cover needs to be landscape and at least 1,600 × 900 pixels. Photos in the body can be any size. Photos are resized and their location data is
      removed before upload.
    </p>

    <p v-if="!photos.length" class="border-border rounded-md border border-dashed p-4 text-center text-sm">
      No photos yet. Add a cover photo, and any photos for the body.
    </p>

    <ul v-else class="space-y-3">
      <li v-for="photo in photos" :key="photo.id" class="border-border overflow-hidden rounded-lg border">
        <NuxtImg :src="publicUrl(photo.card_path ?? photo.storage_path)" :alt="photo.alt_text" width="600"
          :height="Math.round((600 * photo.height) / photo.width)" class="h-auto w-full" loading="lazy" />
        <div class="space-y-2 p-3 text-sm">
          <div class="flex flex-wrap gap-1">
            <UiBadge v-if="photo.id === coverId">
              <Icon name="lucide:star" aria-hidden="true" />Draft cover
            </UiBadge>
            <UiBadge v-if="liveIds.has(photo.id)" variant="secondary">
              <Icon name="lucide:globe" aria-hidden="true" />In the published version
            </UiBadge>
          </div>
          <p>{{ photo.alt_text }}</p>
          <p class="text-muted-foreground">
            {{ size(photo) }}
            <template v-if="photoCredit(photo)"> · <PhotoCredit :credit="photoCredit(photo)" /></template>
          </p>
          <p v-if="photo.id !== coverId && coverSizeProblem(photo)" class="text-muted-foreground">
            Too small or not landscape for the cover.
          </p>
          <div class="flex flex-wrap gap-1">
            <UiButton v-if="photo.id !== coverId && !coverSizeProblem(photo)" size="sm" variant="outline" :disabled="busy"
              @click="emit('cover', photo.id)">
              Use as cover
            </UiButton>
            <UiButton size="sm" variant="ghost" :disabled="busy" @click="openEdit(photo)">Edit details</UiButton>
            <UiButton size="sm" variant="ghost" class="text-destructive" :disabled="busy || liveIds.has(photo.id)"
              :aria-describedby="liveIds.has(photo.id) ? `live-note-${photo.id}` : undefined" @click="askRemove(photo)">
              Delete
            </UiButton>
          </div>
          <p v-if="liveIds.has(photo.id)" :id="`live-note-${photo.id}`" class="text-muted-foreground">
            It's used by the published version. Publish without it first, then delete it.
          </p>
        </div>
      </li>
    </ul>

    <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" tabindex="-1"
      aria-hidden="true" @change="onFilesChosen">
  </section>

  <!-- Details: shared by adding and editing -->
  <UiDialog :open="addOpen || editOpen"
    @update:open="(open: boolean) => { if (!open) { if (addOpen) closeAdd(); else editOpen = false; } }">
    <UiDialogContent :title="addOpen ? 'Add this photo' : 'Photo details'"
      description="Alt text describes the photo for people who use screen readers. The credit is shown under the photo."
      class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <template #content>
        <form id="guide-photo-details" class="space-y-4" novalidate @submit="addOpen ? upload($event) : saveEdit($event)">
          <NuxtImg v-if="addOpen && pending" provider="none" :src="pending.previewUrl" alt="" :width="pending.prepared.width"
            :height="pending.prepared.height" class="h-auto max-h-64 w-full rounded-md object-contain" />
          <p v-if="addOpen && pending" class="text-muted-foreground text-sm">
            {{ size(pending.prepared) }}<template v-if="coverSizeProblem(pending.prepared)">: fine in the body, too small or
              not landscape for the cover.</template><template v-else>: can be the cover.</template>
          </p>

          <UiVeeTextarea name="alt_text" label="What's in the photo?" required :rows="2" maxlength="200"
            hint="For example: Murals along the BeltLine's Eastside Trail on a sunny afternoon." />

          <UiVeeRadioGroup name="source" label="Where's it from?" required>
            <label v-for="opt in [
              { value: 'own', label: 'My own photo' },
              { value: 'unsplash', label: 'Unsplash' },
              { value: 'other', label: 'Another licence' },
            ]" :key="opt.value" class="flex min-h-9 cursor-pointer items-center gap-3">
              <UiRadioGroupItem :value="opt.value" />
              <span class="text-sm">{{ opt.label }}</span>
            </label>
          </UiVeeRadioGroup>

          <template v-if="source === 'own'">
            <UiVeeInput name="credit_name" label="Credit (optional)" hint="Shown as “Photo: …”. Leave empty for none." />
          </template>

          <template v-else-if="source === 'unsplash'">
            <UiVeeInput name="source_url" label="The photo's Unsplash page" required type="url"
              placeholder="https://unsplash.com/photos/…" />
            <UiVeeInput name="credit_name" label="Photographer's name" required hint="As shown on the photo's page." />
            <UiVeeInput name="credit_url" label="Photographer's Unsplash profile" required type="url"
              placeholder="https://unsplash.com/@…" />
          </template>

          <template v-else>
            <UiVeeInput name="credit_name" label="Credit" required hint="What the licence asks you to show, such as the photographer's name." />
            <UiVeeInput name="licence" label="Licence" required placeholder="CC BY 4.0" />
            <UiVeeInput name="source_url" label="Where the photo and its licence are shown" required type="url"
              placeholder="https://…" />
            <UiVeeCheckbox name="commercial_use_confirmed" label="I've checked this licence allows commercial use." />
          </template>

          <div class="bg-muted rounded-md p-3 text-sm">
            <p class="font-medium">Shown under the photo</p>
            <p class="text-muted-foreground mt-1">
              <PhotoCredit v-if="creditPreview" :credit="creditPreview" />
              <template v-else>No credit.</template>
            </p>
          </div>
        </form>
      </template>
      <template #footer>
        <UiDialogFooter>
          <UiButton variant="outline" @click="addOpen ? closeAdd() : (editOpen = false)">
            {{ addOpen ? "Skip this photo" : "Cancel" }}
          </UiButton>
          <UiButton type="submit" form="guide-photo-details" :disabled="busy">
            {{ busy ? "Saving…" : addOpen ? "Add photo" : "Save details" }}
          </UiButton>
        </UiDialogFooter>
      </template>
    </UiDialogContent>
  </UiDialog>

  <UiAlertDialog v-model:open="removeOpen" title="Delete this photo?" :description="removeDescription">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep photo" />
        <UiAlertDialogAction text="Delete photo" variant="destructive" :disabled="busy" @click.prevent="confirmRemove()" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
