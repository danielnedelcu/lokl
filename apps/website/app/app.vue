<template>
  <div>
    <NuxtRouteAnnouncer />
    <!-- Smooth scrolling only for those who haven't asked their device to
         reduce motion; otherwise the browser's own scrolling (WCAG 2.3.3). -->
    <ClientOnly><VueLenis v-if="motion !== 'reduce'" root :auto-raf="false" /></ClientOnly>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UiSonner />
    <!-- The sign-in dialog (useSignIn) and the hearts' announcements, for every page. -->
    <ClientOnly><SignInDialog /></ClientOnly>
  </div>
</template>

<script setup lang="ts">
import Tempus from "tempus";

const lenis = useLenis();
// "reduce" when the device asks for less motion; follows a change of setting.
const motion = usePreferredReducedMotion();

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
