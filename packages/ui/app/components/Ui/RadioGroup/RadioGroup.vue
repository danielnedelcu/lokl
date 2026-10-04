<!--
  lokl change (docs/frontend.md, 2026-10-04): an arrow key selects the radio
  it moves to, however quickly the key is released. Reka moves focus on the
  key press but selects later, in a timer, and only if the key is still held
  then; an instant press and release (voice control, switch devices, any
  scripted key) moved focus without selecting. Native radios select at once,
  so this selects the newly focused radio as soon as Reka has moved focus.
  Keep it if the component is re-added with the ui-thing CLI.
-->
<template>
  <RadioGroupRoot
    ref="root"
    data-slot="radio-group"
    v-bind="forwarded"
    @keydown="selectFocused"
    :class="styles({ class: normalizeClass(props.class) || undefined })"
  >
    <slot />
  </RadioGroupRoot>
</template>

<script lang="ts" setup>
  import { RadioGroupRoot, useForwardPropsEmits } from "reka-ui";
  import type { RadioGroupRootEmits, RadioGroupRootProps } from "reka-ui";
  import { nextTick, normalizeClass, useTemplateRef } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<
      RadioGroupRootProps & {
        /** Custom class(es) to add to the parent. */
        class?: HTMLAttributes["class"];
      }
    >(),
    {
      orientation: "vertical",
      loop: true,
    }
  );

  const emits = defineEmits<RadioGroupRootEmits>();
  const forwarded = useForwardPropsEmits(reactiveOmit(props, "class"), emits);

  const styles = tv({ base: "grid gap-3" });

  // See the note at the top. Reka moves focus in the next tick; this runs after it.
  const root = useTemplateRef<{ $el: HTMLElement }>("root");
  const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  function selectFocused(event: KeyboardEvent) {
    if (!ARROWS.includes(event.key) || props.disabled) return;
    void nextTick(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "radio" || !root.value?.$el.contains(el)) return;
      if (el.getAttribute("aria-checked") !== "true" && !el.hasAttribute("data-disabled")) el.click();
    });
  }
</script>
