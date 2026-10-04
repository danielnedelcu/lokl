<script setup lang="ts">
import type { Provider } from "@repo/types";

// The profile photo or cover photo on the Business profile page
// (docs/design/provider-profiles.md, Photos and Editing it). Prepared in the
// browser (prepareProfilePhoto.ts), previewed in its real shape before
// saving, uploaded into the provider's own folder of the provider-photos
// bucket, then recorded on their row (the database checks the folder).
// Replacing or removing deletes the old files.
const props = defineProps<{ kind: "avatar" | "cover"; provider: Provider }>();
const emit = defineEmits<{ changed: [] }>();

const supabase = useSupabaseClient();
const photoUrl = useProviderPhotoUrl();
const isAvatar = computed(() => props.kind === "avatar");
const columns = computed(() =>
  isAvatar.value ? (["avatar_path", "avatar_small_path"] as const) : (["cover_path", "cover_card_path"] as const));
const current = computed(() => props.provider[columns.value[0]]);
// The row's two columns for this photo, set or cleared together.
const fields = (main: string | null, small: string | null) =>
  isAvatar.value ? { avatar_path: main, avatar_small_path: small } : { cover_path: main, cover_card_path: small };
const currentFiles = computed(() => columns.value.map((c) => props.provider[c]).filter((p): p is string => !!p));
const label = computed(() => (isAvatar.value ? "Profile photo" : "Cover photo"));
const hint = computed(() =>
  isAvatar.value
    ? "A photo of you or your logo. It's shown round, cropped to the middle square."
    : "A wide photo of your work or your place, at least 1,600 × 600 pixels. It's shown as a band across the top of your profile.");

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const pending = ref<{ prepared: PreparedProfilePhoto; previewUrl: string } | null>(null);
const confirmOpen = ref(false);
const removeOpen = ref(false);

async function onChosen(e: Event) {
  const el = e.target as HTMLInputElement;
  const file = el.files?.[0];
  el.value = "";
  if (!file) return;
  busy.value = true;
  try {
    const prepared = isAvatar.value ? await prepareAvatar(file) : await prepareCover(file);
    discardPending();
    pending.value = { prepared, previewUrl: URL.createObjectURL(prepared.blob) };
    confirmOpen.value = true;
  } catch (err) {
    useSonner.error(err instanceof ProfilePhotoError ? err.message : "That photo couldn't be used. Try a different one.");
  } finally {
    busy.value = false;
  }
}
function discardPending() {
  if (pending.value) URL.revokeObjectURL(pending.value.previewUrl);
  pending.value = null;
}
function cancel() {
  confirmOpen.value = false;
  discardPending();
}

async function save() {
  const p = pending.value;
  if (!p) return;
  busy.value = true;
  const id = crypto.randomUUID();
  const smallName = isAvatar.value ? "small" : "card";
  const paths = [`${props.provider.id}/${props.kind}-${id}.${p.prepared.ext}`, `${props.provider.id}/${props.kind}-${id}-${smallName}.${p.prepared.ext}`] as const;
  const bucket = supabase.storage.from(PROVIDER_PHOTO_BUCKET);
  try {
    for (const [path, blob] of [[paths[0], p.prepared.blob], [paths[1], p.prepared.small]] as const) {
      const { error } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
      if (error) throw error;
    }
    const old = currentFiles.value;
    const e = changedRows(
      await supabase.from("providers").update(fields(paths[0], paths[1])).eq("id", props.provider.id).select("id"),
    );
    if (e) {
      await bucket.remove([...paths]);
      throw e;
    }
    if (old.length) await bucket.remove(old);
    useSonner.success(`${label.value} saved.`);
    confirmOpen.value = false;
    discardPending();
    emit("changed");
  } catch (err) {
    useSonner.error(problemText(err, `The ${label.value.toLowerCase()} wasn't saved. Try again.`));
  } finally {
    busy.value = false;
  }
}

async function remove() {
  busy.value = true;
  const old = currentFiles.value;
  const e = changedRows(
    await supabase.from("providers").update(fields(null, null)).eq("id", props.provider.id).select("id"), "changed");
  busy.value = false;
  removeOpen.value = false;
  if (e) return useSonner.error(problemText(e, `The ${label.value.toLowerCase()} wasn't removed. Try again.`));
  await supabase.storage.from(PROVIDER_PHOTO_BUCKET).remove(old);
  useSonner.success(`${label.value} removed.`);
  emit("changed");
}
onBeforeUnmount(discardPending);
</script>

<template>
  <section :aria-labelledby="`${kind}-heading`" class="space-y-2">
    <h2 :id="`${kind}-heading`" class="text-sm font-medium">{{ label }}</h2>
    <p :id="`${kind}-hint`" class="text-muted-foreground text-sm">{{ hint }}</p>

    <div v-if="current" class="flex flex-wrap items-center gap-4">
      <img v-if="isAvatar" :src="photoUrl(current)!" alt="" class="bg-muted size-24 rounded-full object-cover">
      <img v-else :src="photoUrl(current)!" alt="" class="bg-muted aspect-[3/1] w-full rounded-lg object-cover">
      <div class="flex gap-2">
        <UiButton variant="outline" :disabled="busy" @click="input?.click()">Replace</UiButton>
        <UiButton variant="ghost" class="text-destructive" :disabled="busy" @click="removeOpen = true">Remove</UiButton>
      </div>
    </div>
    <!-- The same large area as guide photos: one button that opens the file picker. -->
    <button v-else type="button" :disabled="busy" :aria-describedby="`${kind}-hint`"
      class="border-border bg-muted/50 text-muted-foreground hover:border-foreground/40 hover:text-foreground focus-visible:ring-ring/50 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"
      @click="input?.click()">
      <span class="bg-background flex size-10 items-center justify-center rounded-full border shadow-sm">
        <Icon :name="busy ? 'lucide:loader-circle' : 'lucide:cloud-upload'" :class="['size-5', busy && 'animate-spin']" aria-hidden="true" />
      </span>
      <span class="text-foreground text-sm font-medium">{{ busy ? "Preparing the photo…" : `Click to add a ${label.toLowerCase()}` }}</span>
      <span class="text-xs">JPEG, PNG or WebP. Location data is removed before upload.</span>
    </button>
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-hidden="true" @change="onChosen">

    <UiDialog :open="confirmOpen" @update:open="(o: boolean) => { if (!o) cancel(); }">
      <UiDialogContent :title="`Use this ${label.toLowerCase()}?`"
        :description="isAvatar ? 'This is how it will look: the middle square, shown round.' : 'This is how it will look across the top of your profile. On phones the band is taller.'">
        <template #content>
          <div v-if="pending" class="flex justify-center py-2">
            <img v-if="isAvatar" :src="pending.previewUrl" alt="" class="size-40 rounded-full object-cover">
            <img v-else :src="pending.previewUrl" alt="" class="aspect-[3/1] w-full rounded-lg object-cover">
          </div>
        </template>
        <template #footer>
          <UiDialogFooter class="flex-wrap gap-2">
            <UiButton variant="outline" :disabled="busy" @click="cancel">Cancel</UiButton>
            <UiButton variant="outline" :disabled="busy" @click="input?.click()">Choose another</UiButton>
            <UiButton :disabled="busy" @click="save">{{ busy ? "Saving…" : "Use this photo" }}</UiButton>
          </UiDialogFooter>
        </template>
      </UiDialogContent>
    </UiDialog>

    <UiAlertDialog v-model:open="removeOpen" :title="`Remove your ${label.toLowerCase()}?`"
      :description="isAvatar ? 'Your profile shows your initials instead.' : 'Your profile shows a plain band instead.'">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiAlertDialogAction text="Remove" variant="destructive" :disabled="busy" @click.prevent="remove" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
  </section>
</template>
