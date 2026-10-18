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
  lokl change (2026-10-18): Reka's own delayed select can't undo a later
  press. Reka still clicks a radio a moment after it gets focus, if an
  arrow key is held then. On a busy page those timers run late: with two
  quick presses, the first radios' timers fired while the second key was
  held and clicked radios that no longer had focus, so the selection fell
  back behind focus (CI, journey 2 at phone size, and journey 29). Such a
  click (made by code, while an arrow key is held, on a radio of this group
  that hasn't focus and isn't the one just selected here) is stopped before
  Reka sees it. People's clicks, and a timer's click on the focused radio,
  go through. E2e journey 2 recreates the late timers.
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
  import { normalizeClass, onBeforeUnmount, onMounted, useTemplateRef } from "vue";
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
  // See the note at the top (2026-10-18): stop Reka's late select of a radio
  // focus has left. Arrow keys held, as Reka tracks them (on the window).
  const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  let arrowHeld = false;
  useEventListener("keydown", (e: KeyboardEvent) => {
    if (ARROWS.includes(e.key)) arrowHeld = true;
  });
  useEventListener("keyup", () => {
    arrowHeld = false;
  });
  // The radio this group's own keydown just selected (focus reaches it after).
  let selecting: HTMLElement | null = null;
  function stopStaleSelect(event: MouseEvent) {
    const el = root.value?.$el;
    const radio = event.target;
    if (event.isTrusted || !arrowHeld || !(el instanceof HTMLElement) || !(radio instanceof HTMLElement)) return;
    if (radio.getAttribute("role") !== "radio" || radio.closest('[role="radiogroup"]') !== el) return;
    if (radio === selecting || radio === document.activeElement) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }
  onMounted(() => root.value?.$el?.addEventListener("click", stopStaleSelect, true));
  onBeforeUnmount(() => root.value?.$el?.removeEventListener("click", stopStaleSelect, true));

  function selectTarget(event: KeyboardEvent) {
    if (props.disabled) return;
    const el = root.value?.$el;
    const from = event.target;
    if (!(el instanceof HTMLElement) || !(from instanceof HTMLElement) || from.getAttribute("role") !== "radio") return;
    // This group's own radios, not those of a group nested inside it.
    const radios = [...el.querySelectorAll<HTMLElement>('[role="radio"]')].filter((r) => r.closest('[role="radiogroup"]') === el);
    if (!radios.includes(from)) return;
    const target = arrowTarget(event, radios, from);
    if (target && target !== from && target.getAttribute("aria-checked") !== "true") {
      selecting = target;
      target.click();
      selecting = null;
    }
  }
</script>
