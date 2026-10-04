<script setup lang="ts">
// A provider's round profile photo, or their initials on a neutral circle
// when they haven't added one (docs/design/provider-profiles.md). Always
// decorative: the business name is written next to it.
const props = withDefaults(defineProps<{ name: string; path?: string | null; size?: number }>(), { size: 48 });
const photoUrl = useProviderPhotoUrl();
const src = computed(() => photoUrl(props.path));
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join(""),
);
</script>

<template>
  <img v-if="src" :src="src" alt="" :width="size" :height="size" loading="lazy"
    class="bg-muted shrink-0 rounded-full object-cover" :style="{ width: `${size}px`, height: `${size}px` }">
  <span v-else aria-hidden="true" class="bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full font-medium"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }">{{ initials }}</span>
</template>
