<template>
  <SelectIcon data-slot="select-icon" v-bind="forwarded" class="flex items-center justify-center">
    <slot>
      <Icon
        :class="styles({ class: normalizeClass(props.class) || undefined })"
        :name="icon || 'lucide:chevron-down'"
      />
    </slot>
  </SelectIcon>
</template>

<script lang="ts" setup>
  import { SelectIcon, useForwardProps } from "reka-ui";
  import type { SelectIconProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = defineProps<
    SelectIconProps & {
      /** Icon to render. */
      icon?: string;
      /** Custom class(es) to add to the parent. */
      class?: HTMLAttributes["class"];
    }
  >();
  const forwarded = useForwardProps(reactiveOmit(props, "class"));

  const styles = tv({
    // lokl change: the muted text colour, not half opacity, so it matches
    // SearchSelect's chevron and isn't washed out (2026-10-03).
    base: "text-muted-foreground size-4 shrink-0",
  });
</script>
