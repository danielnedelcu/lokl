<template>
  <div>
    <NuxtRouteAnnouncer />
    <VueLenis root :auto-raf="false" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiSonner />
  </div>
</template>

<script setup lang="ts">
import Tempus from "tempus";

const lenis = useLenis();

let stop: (() => void) | undefined;

watch(
  lenis,
  (instance) => {
    stop?.();
    stop = instance
      ? Tempus.add((state) => instance.raf(state.time))
      : undefined;
  },
  { immediate: true },
);

onBeforeUnmount(() => stop?.());
</script>
