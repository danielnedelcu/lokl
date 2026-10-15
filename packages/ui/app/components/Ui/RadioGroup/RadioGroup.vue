<!--
  lokl change (docs/frontend.md, 2026-10-04): an arrow key selects the radio
  it moves to, however quickly the key is released. Reka moves focus on the
  key press but selects later, in a timer, and only if the key is still held
  then; an instant press and release (voice control, switch devices, any
  scripted key) moved focus without selecting. Native radios select at once,
  so this selects, in the keydown handler itself, the radio the key moves to,
  chosen by Reka's own rules (orientation, reading direction, looping,
  skipping disabled radios); Reka then moves focus to the same radio.
  (2026-10-11: it used to wait a tick and select whatever had focus, which
  depended on Reka having moved focus by then, and failed in CI.)
  Keep it if the component is re-added with the ui-thing CLI.
  lokl change (2026-10-15): `grid` lets all four arrow keys move, for radios
  laid out in rows and columns (the scheduling panel's times): Reka is given
  no orientation, which its roving focus reads as both.
-->
<template>
  <RadioGroupRoot
    ref="root"
    data-slot="radio-group"
    v-bind="forwarded"
    :orientation="grid ? undefined : orientation"
    @keydown="selectTarget"
    :class="styles({ class: normalizeClass(props.class) || undefined })"
  >
    <slot />
  </RadioGroupRoot>
</template>

<script lang="ts" setup>
  import { RadioGroupRoot, useForwardPropsEmits } from "reka-ui";
  import type { RadioGroupRootEmits, RadioGroupRootProps } from "reka-ui";
  import { normalizeClass, useTemplateRef } from "vue";
  import type { HTMLAttributes } from "vue";

  const props = withDefaults(
    defineProps<
      RadioGroupRootProps & {
        /** Custom class(es) to add to the parent. */
        class?: HTMLAttributes["class"];
        /** Radios in rows and columns: every arrow key moves (lokl change). */
        grid?: boolean;
      }
    >(),
    {
      orientation: "vertical",
      loop: true,
    }
  );

  const emits = defineEmits<RadioGroupRootEmits>();
  const forwarded = useForwardPropsEmits(reactiveOmit(props, "class", "grid", "orientation"), emits);

  const styles = tv({ base: "grid gap-3" });

  // See the note at the top: the radio an arrow key moves to, the way Reka's
  // roving focus chooses it (RovingFocusItem's keydown, getFocusIntent).
  const root = useTemplateRef<{ $el: HTMLElement }>("root");
  function arrowTarget(event: KeyboardEvent, radios: HTMLElement[], from: HTMLElement): HTMLElement | undefined {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return undefined;
    const rtl = (props.dir ?? getComputedStyle(from).direction) === "rtl";
    const key = rtl && event.key === "ArrowLeft" ? "ArrowRight" : rtl && event.key === "ArrowRight" ? "ArrowLeft" : event.key;
    if (!props.grid && props.orientation === "vertical" && (key === "ArrowLeft" || key === "ArrowRight")) return undefined;
    if (!props.grid && props.orientation === "horizontal" && (key === "ArrowUp" || key === "ArrowDown")) return undefined;
    const step = key === "ArrowUp" || key === "ArrowLeft" ? -1 : key === "ArrowDown" || key === "ArrowRight" ? 1 : 0;
    if (!step) return undefined;
    const enabled = radios.filter((r) => r === from || !r.hasAttribute("data-disabled"));
    const at = enabled.indexOf(from);
    if (at < 0) return undefined;
    const next = at + step;
    if (next >= 0 && next < enabled.length) return enabled[next];
    return props.loop ? enabled[(next + enabled.length) % enabled.length] : undefined;
  }
  function selectTarget(event: KeyboardEvent) {
    if (props.disabled) return;
    const el = root.value?.$el;
    const from = event.target;
    if (!(el instanceof HTMLElement) || !(from instanceof HTMLElement) || from.getAttribute("role") !== "radio") return;
    // This group's own radios, not those of a group nested inside it.
    const radios = [...el.querySelectorAll<HTMLElement>('[role="radio"]')].filter((r) => r.closest('[role="radiogroup"]') === el);
    if (!radios.includes(from)) return;
    const target = arrowTarget(event, radios, from);
    if (target && target !== from && target.getAttribute("aria-checked") !== "true") target.click();
  }
</script>
