<script setup lang="ts">
import { z } from "zod";
import type { ListingStatus } from "@repo/types";

// The editor's photo section. Photos are resized and re-encoded in the
// browser first (prepareListingPhoto: max 2,000px, WebP, no location data),
// then uploaded straight to storage, then recorded in listing_photos.
const props = defineProps<{ listingId: string; providerId: string; status: ListingStatus }>();
const emit = defineEmits<{ changed: [count: number] }>();

const BUCKET = "listing-photos";
const MAX_PHOTOS = 8;
const supabase = useSupabaseClient();

interface PhotoRow {
  id: string;
  storage_path: string;
  /** The ~600px card copy (WebP or JPEG); null for older photos (use the full photo). */
  card_path: string | null;
  position: number;
  alt_text: string;
}

const { data: photos, refresh } = await useAsyncData(`listing-photos-${props.listingId}`, async () => {
  const { data, error } = await supabase
    .from("listing_photos")
    .select("id, storage_path, card_path, position, alt_text")
    .eq("listing_id", props.listingId)
    .order("position");
  if (error) throw error;
  return data as PhotoRow[];
});
const list = computed(() => photos.value ?? []);

async function reload() {
  await refresh();
  emit("changed", list.value.length);
}

const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// Same status rules as the database: free in draft, rejected or live; locked
// in submitted or unpublished; a live listing keeps at least one photo.
const editable = computed(() => ["draft", "rejected", "live"].includes(props.status));
const lastLivePhoto = computed(() => props.status === "live" && list.value.length === 1);
const busy = ref(false);

// ---------------------------------------------------------------------------
// Adding: pick files -> prepare each -> describe it -> upload + record
// ---------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const queue = ref<File[]>([]);
const pending = ref<{ prepared: PreparedPhoto; previewUrl: string; fileName: string } | null>(null);
const describeOpen = ref(false);

const altSchema = z.object({
  alt_text: z
    .string()
    .trim()
    .min(5, "Describe the photo in at least 5 characters.")
    .max(200, "Keep the description under 200 characters."),
});
const altForm = useForm<{ alt_text: string }>({ validationSchema: zodSchema(altSchema) });

function choosePhotos() {
  fileInput.value?.click();
}

function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const room = MAX_PHOTOS - list.value.length;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length > room) {
    useSonner.error(`You can add ${room} more photo${room === 1 ? "" : "s"}. A listing has up to ${MAX_PHOTOS}.`);
  }
  queue.value = files.slice(0, room);
  void nextInQueue();
}

async function nextInQueue() {
  const file = queue.value.shift();
  if (!file) return;
  try {
    const prepared = await prepareListingPhoto(file);
    pending.value = { prepared, previewUrl: URL.createObjectURL(prepared.blob), fileName: file.name };
    altForm.resetForm({ values: { alt_text: "" } });
    describeOpen.value = true;
  } catch (e) {
    useSonner.error(e instanceof PhotoError ? `${file.name}: ${e.message}` : `${file.name} couldn't be added.`);
    void nextInQueue();
  }
}

function closeDescribe() {
  if (pending.value) URL.revokeObjectURL(pending.value.previewUrl);
  pending.value = null;
  describeOpen.value = false;
  void nextInQueue();
}

const nextFreePosition = () => {
  const used = new Set(list.value.map((p) => p.position));
  for (let i = 0; i < MAX_PHOTOS; i++) if (!used.has(i)) return i;
  return -1;
};

const uploadPending = altForm.handleSubmit(async ({ alt_text }) => {
  if (!pending.value) return;
  const { prepared } = pending.value;
  const base = `${props.providerId}/${props.listingId}/${crypto.randomUUID()}`;
  const path = `${base}.${prepared.ext}`;
  // The card copy's name is fixed by the database: <photo>.card.webp or .card.jpg.
  const cardPath = `${base}.card.${prepared.cardExt}`;
  const uploaded: string[] = [];
  busy.value = true;
  try {
    const up = await supabase.storage
      .from(BUCKET)
      .upload(path, prepared.blob, { contentType: prepared.blob.type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    uploaded.push(path);
    const card = await supabase.storage
      .from(BUCKET)
      .upload(cardPath, prepared.card, { contentType: prepared.card.type, upsert: false });
    if (card.error) throw new Error(card.error.message);
    uploaded.push(cardPath);

    const { error } = await supabase.from("listing_photos").insert({
      listing_id: props.listingId,
      storage_path: path,
      card_path: cardPath,
      position: nextFreePosition(),
      alt_text,
    });
    if (error) throw new Error(error.message);
    uploaded.length = 0;
    useSonner.success("Photo added.");
    await reload();
  } catch (e) {
    // Don't leave unused files behind.
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
    useSonner.error(`The photo wasn't added: ${(e as Error).message}`);
  } finally {
    busy.value = false;
    closeDescribe();
  }
});

// ---------------------------------------------------------------------------
// Editing, reordering, removing
// ---------------------------------------------------------------------------

const editing = ref<PhotoRow | null>(null);
const editOpen = ref(false);
function openEdit(photo: PhotoRow) {
  editing.value = photo;
  altForm.resetForm({ values: { alt_text: photo.alt_text } });
  editOpen.value = true;
}
const saveEdit = altForm.handleSubmit(async ({ alt_text }) => {
  if (!editing.value) return;
  busy.value = true;
  const { error } = await supabase.from("listing_photos").update({ alt_text }).eq("id", editing.value.id);
  busy.value = false;
  if (error) return useSonner.error(`The description wasn't saved: ${error.message}`);
  useSonner.success("Description saved.");
  editOpen.value = false;
  await reload();
});

async function move(index: number, direction: -1 | 1) {
  const ids = list.value.map((p) => p.id);
  const target = index + direction;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  busy.value = true;
  const { error } = await supabase.rpc("reorder_listing_photos", { p_listing_id: props.listingId, p_photo_ids: ids });
  busy.value = false;
  if (error) return useSonner.error(`The new order wasn't saved: ${error.message}`);
  await reload();
}

const removing = ref<PhotoRow | null>(null);
const removeOpen = ref(false);
function askRemove(photo: PhotoRow) {
  removing.value = photo;
  removeOpen.value = true;
}
async function confirmRemove() {
  const photo = removing.value;
  if (!photo) return;
  busy.value = true;
  const { error } = await supabase.from("listing_photos").delete().eq("id", photo.id);
  if (!error) {
    // The row is gone; remove the file too, so it isn't left in storage.
    await supabase.storage.from(BUCKET).remove([photo.storage_path, ...(photo.card_path ? [photo.card_path] : [])]);
  }
  busy.value = false;
  removeOpen.value = false;
  if (error) return useSonner.error(error.message);
  useSonner.success("Photo removed.");
  await reload();
}
</script>

<template>
  <UiCard>
    <UiCardHeader>
      <UiCardTitle as="h2">Photos</UiCardTitle>
      <UiCardDescription>
        Up to {{ MAX_PHOTOS }}. The first one is the cover. At least one is needed before it can go live.
      </UiCardDescription>
    </UiCardHeader>
    <UiCardContent class="space-y-4">
      <p v-if="!editable" class="text-muted-foreground text-sm">
        Photos can't be changed while this listing is {{ status === "submitted" ? "in review" : "taken down" }}.
      </p>

      <p v-if="!list.length" class="border-border rounded-md border border-dashed p-6 text-center text-sm">
        No photos yet. Add at least one so customers can see what they're booking.
      </p>

      <ul v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <li v-for="(photo, i) in list" :key="photo.id" class="border-border overflow-hidden rounded-lg border">
          <div class="relative">
            <NuxtImg :src="publicUrl(photo.card_path ?? photo.storage_path)" :alt="photo.alt_text" width="600" height="450"
              class="aspect-[4/3] w-full object-cover" loading="lazy" />
            <UiBadge v-if="i === 0" class="absolute top-2 left-2">Cover</UiBadge>
          </div>
          <div class="space-y-2 p-3">
            <p class="text-sm">{{ photo.alt_text }}</p>
            <div v-if="editable" class="flex flex-wrap gap-1">
              <UiButton size="icon-touch" variant="ghost" :disabled="busy || i === 0"
                :aria-label="`Move photo ${i + 1} earlier`" @click="move(i, -1)">
                <Icon name="lucide:arrow-left" aria-hidden="true" />
              </UiButton>
              <UiButton size="icon-touch" variant="ghost" :disabled="busy || i === list.length - 1"
                :aria-label="`Move photo ${i + 1} later`" @click="move(i, 1)">
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </UiButton>
              <UiButton variant="ghost" :disabled="busy" @click="openEdit(photo)">
                Edit description
              </UiButton>
              <UiButton variant="ghost" class="text-destructive" :disabled="busy || lastLivePhoto"
                :aria-describedby="lastLivePhoto ? 'last-photo-note' : undefined" @click="askRemove(photo)">
                Remove
              </UiButton>
            </div>
          </div>
        </li>
      </ul>
      <p v-if="lastLivePhoto" id="last-photo-note" class="text-muted-foreground text-sm">
        A live listing needs at least one photo. Add another before removing this one, or unlist it.
      </p>

      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only"
        tabindex="-1" aria-hidden="true" @change="onFilesChosen">
      <UiButton v-if="editable" variant="outline" :disabled="busy || list.length >= MAX_PHOTOS" @click="choosePhotos">
        {{ list.length >= MAX_PHOTOS ? `${MAX_PHOTOS} photos added` : "Add photos" }}
      </UiButton>
      <p class="text-muted-foreground text-xs">
        Photos are resized and their location data is removed before upload.
      </p>
    </UiCardContent>
  </UiCard>

  <!-- Describe a new photo before it's uploaded -->
  <UiDialog :open="describeOpen" @update:open="(open: boolean) => { if (!open) closeDescribe(); }">
    <UiDialogContent title="Describe this photo" description="This helps customers who use screen readers.">
      <template #content>
        <form id="describe-photo" class="space-y-4" novalidate @submit="uploadPending">
          <!-- A local preview (blob: URL) before upload; "none" keeps any future
               image provider from trying to fetch it. -->
          <NuxtImg v-if="pending" provider="none" :src="pending.previewUrl" alt="" width="800" height="600"
            class="aspect-[4/3] w-full rounded-md object-cover" />
          <UiVeeTextarea name="alt_text" label="What's in the photo?" required :rows="2" maxlength="200"
            hint="For example: A stylist trimming a customer's hair in a sunny salon." />
        </form>
      </template>
      <template #footer>
        <UiDialogFooter>
          <UiButton variant="outline" @click="closeDescribe">Skip this photo</UiButton>
          <UiButton type="submit" form="describe-photo" :disabled="busy">{{ busy ? "Adding…" : "Add photo" }}</UiButton>
        </UiDialogFooter>
      </template>
    </UiDialogContent>
  </UiDialog>

  <!-- Edit an existing photo's description -->
  <UiDialog v-model:open="editOpen">
    <UiDialogContent title="Edit description" description="This helps customers who use screen readers.">
      <template #content>
        <form id="edit-photo" class="space-y-4" novalidate @submit="saveEdit">
          <NuxtImg v-if="editing" :src="publicUrl(editing.storage_path)" alt="" width="800" height="600"
            class="aspect-[4/3] w-full rounded-md object-cover" />
          <UiVeeTextarea name="alt_text" label="What's in the photo?" required :rows="2" maxlength="200" />
        </form>
      </template>
      <template #footer>
        <UiDialogFooter>
          <UiButton variant="outline" @click="editOpen = false">Cancel</UiButton>
          <UiButton type="submit" form="edit-photo" :disabled="busy">Save description</UiButton>
        </UiDialogFooter>
      </template>
    </UiDialogContent>
  </UiDialog>

  <UiAlertDialog v-model:open="removeOpen" title="Remove this photo?"
    description="It will be deleted from your listing. This can't be undone.">
    <template #footer>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel text="Keep photo" />
        <UiAlertDialogAction text="Remove photo" variant="destructive" :disabled="busy" @click.prevent="confirmRemove()" />
      </UiAlertDialogFooter>
    </template>
  </UiAlertDialog>
</template>
