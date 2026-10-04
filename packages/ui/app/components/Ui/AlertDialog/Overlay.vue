<!--
  lokl change (docs/frontend.md, 2026-10-04): the backdrop behind an alert dialog is
  the theme's overlay colour (bg-overlay: black at 40%, --overlay in
  tailwind.css), with no blur, instead of ui-thing's blurred, half-white
  background. Keep this if the component is re-added with the
  ui-thing CLI.
-->
<template>
  <AlertDialogOverlay
    data-slot="alert-dialog-overlay"
    v-bind="forwarded"
    :class="styles({ class: normalizeClass(props.class) || undefined })"
  />
</template>

<script lang="ts" setup>
  import { AlertDialogOverlay } from "reka-ui";
  import type { AlertDialogOverlayProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = defineProps<
    AlertDialogOverlayProps & {
      /** Custom class(es) to add to the overlay. */
      class?: HTMLAttributes["class"];
    }
  >();
  const forwarded = reactiveOmit(props, "class");
  const styles = tv({
    base: [
      "bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50",
    ],
  });
</script>
