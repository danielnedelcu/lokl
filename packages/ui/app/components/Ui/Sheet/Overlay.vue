<!--
  lokl change (docs/frontend.md, 2026-10-04): the backdrop behind a sheet is
  the theme's overlay colour (bg-overlay: black at 40%, --overlay in
  tailwind.css), with no blur, instead of ui-thing's blurred, half-white
  background. The isBlurred prop is kept
  but no longer blurs. Keep this if the component is re-added with the
  ui-thing CLI.
-->
<template>
  <DialogOverlay
    data-slot="sheet-overlay"
    :class="styles({ isBlurred, class: normalizeClass(props.class) || undefined })"
    v-bind="forwarded"
  />
</template>

<script lang="ts" setup>
  import { DialogOverlay } from "reka-ui";
  import type { DialogOverlayProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<
      DialogOverlayProps & {
        /** Custom class(es) to add to parent element. */
        class?: HTMLAttributes["class"];
        /**
         * Kept for ui-thing's API; lokl's backdrop is never blurred (see top).
         *
         * @default true
         */
        isBlurred?: boolean;
      }
    >(),
    {
      isBlurred: true,
    }
  );

  const forwarded = reactiveOmit(props, "class");
  const styles = tv({
    base: "bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50",
    variants: {
      isBlurred: {
        true: "",
        false: "",
      },
    },
  });
</script>
