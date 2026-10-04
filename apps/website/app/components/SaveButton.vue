<script setup lang="ts">
import type { SavedKind } from "~/composables/useSaved";

// The heart (docs/design/favourites.md, The heart): a toggle button with a
// constant name ("Save Sweet Auburn Food Walk") and its state as pressed or
// not, 44 × 44 pixels, outlined or filled (never colour alone), with a
// "Save" or "Saved" tooltip. Hidden on a provider's own listings and
// profile. Until the person's saved items have loaded it doesn't respond,
// so a quick tap can't unsave something already saved. Browser only: pages
// are built as a signed-out visitor sees them.
const props = withDefaults(defineProps<{
  kind: SavedKind;
  id: string;
  /** What's being saved, for its name: the listing's title or the business name. */
  name: string;
  /** Whose it is: the heart is hidden on the signed-in provider's own. */
  providerId: string;
  /** "overlay": a white circle over a photo (cards); "plain": beside a heading. */
  variant?: "overlay" | "plain";
}>(), { variant: "plain" });

const user = useSupabaseUser();
const { load, loaded, isSaved, isSending, toggle, ownProviderId } = useSaved();
onMounted(() => void load());
const own = computed(() => !!ownProviderId.value && ownProviderId.value === props.providerId);
const pressed = computed(() => isSaved(props.kind, props.id));
// Signed out it always responds (it asks them to sign in).
const ready = computed(() => !user.value || loaded.value);
</script>

<template>
  <ClientOnly>
    <UiTooltip v-if="!own">
      <UiTooltipTrigger as-child>
        <button type="button" :aria-label="`Save ${name}`" :aria-pressed="pressed" :aria-disabled="!ready || undefined"
          :aria-busy="isSending(kind, id) || undefined"
          :class="[
            'focus-visible:ring-ring/50 inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]',
            variant === 'overlay' ? 'bg-background/90 shadow-sm backdrop-blur hover:bg-background' : 'hover:bg-accent',
          ]"
          @click="ready && toggle(kind, id, name)">
          <Icon name="lucide:heart" :class="['size-6', pressed ? 'fill-rose-600 text-rose-600' : 'text-foreground']" aria-hidden="true" />
        </button>
      </UiTooltipTrigger>
      <UiTooltipContent>{{ pressed ? "Saved" : "Save" }}</UiTooltipContent>
    </UiTooltip>
    <template #fallback>
      <span v-if="variant === 'overlay'" class="inline-block size-11" aria-hidden="true" />
    </template>
  </ClientOnly>
</template>
