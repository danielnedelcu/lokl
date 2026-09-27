<!--
  lokl change: imports Button with a relative path. In a Nuxt layer, "~"
  points at the app extending the layer, so "~/components/Ui/Button.vue"
  isn't found. Keep this if the component is re-added with the ui-thing CLI.
-->
<template>
  <AlertDialogAction
    data-slot="alert-dialog-action"
    v-bind="forwarded"
    :class="
      buttonStyles({ variant, size, disabled, class: normalizeClass(props.class) || undefined })
    "
  >
    <slot>{{ text }} </slot>
  </AlertDialogAction>
</template>

<script lang="ts" setup>
  import { AlertDialogAction } from "reka-ui";
  import type { AlertDialogActionProps } from "reka-ui";
  import { normalizeClass } from "vue";

  import { buttonStyles } from "../Button.vue";

  const props = withDefaults(
    defineProps<
      AlertDialogActionProps & {
        /** Action to perform when the button is clicked. */
        onClick?: () => void;
        /** Text to display in the button. */
        text?: string;
        /** Custom class(es) to add to the button. */
        class?: any;
        /** Whether the button is disabled. */
        disabled?: boolean;
        /** The button's visual variant. */
        variant?: VariantProps<typeof buttonStyles>["variant"];
        /** The button's visual size. */
        size?: VariantProps<typeof buttonStyles>["size"];
      }
    >(),
    {
      text: "Continue",
      variant: "default",
      size: "default",
    }
  );

  const forwarded = reactiveOmit(props, "class", "text", "variant", "size");
</script>
