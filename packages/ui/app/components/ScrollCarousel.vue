<script setup lang="ts" generic="T">
// A horizontal carousel of cards (2026-10-12; docs/frontend.md, Carousels):
// a CSS grid track that scrolls sideways and snaps to each card's start.
// About 1.2 cards show on phones, 3 on tablets and 5 on desktop. On phones
// and tablets the track runs to both screen edges (full bleed), with the
// page's 16px added back inside it and as scroll padding, so the first card
// lines up with the page and snapping does too; on desktop it stays within
// the content width (4px of room, added and taken back, so focus rings
// aren't clipped). Every card stays in the list and reachable by keyboard
// and screen reader; none is hidden when it's off screen.
//
// Previous and Next scroll by one page of visible cards (smooth, or instant
// with "reduce motion"), are named for the carousel ("Scroll Services
// left") and point at the track (aria-controls). At the ends they're marked
// aria-disabled, not disabled, so a button keeps focus when it reaches the
// end. The track has data-lenis-prevent-horizontal: a sideways (or
// slightly diagonal) trackpad gesture scrolls it, not the page.
const props = withDefaults(
  defineProps<{
    /** The carousel's name: its heading, and the buttons' ("Scroll Services left"). */
    label: string;
    items: T[];
    itemKey: (item: T) => string;
    headingLevel?: 2 | 3;
    /** The "See all" card at the end. */
    seeAll?: { href: string; label: string };
  }>(),
  { headingLevel: 2 },
);

const id = useId();
const track = useTemplateRef<HTMLElement>("track");
const atStart = ref(true);
const atEnd = ref(true);

let frame = 0;
function measure() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const t = track.value;
    if (!t) return;
    atStart.value = t.scrollLeft <= 1;
    atEnd.value = t.scrollLeft + t.clientWidth >= t.scrollWidth - 1;
  });
}

// Where the last press was heading, while its smooth scroll is still
// running: a quick second press goes a page on from there, not from wherever
// the first had got to (which, with snapping, could land short).
let heading: number | null = null;
let headingTimer: ReturnType<typeof setTimeout> | undefined;

/** One page of visible cards: the track's visible width, less its padding. */
function scrollPage(direction: -1 | 1) {
  const t = track.value;
  if (!t || (direction < 0 ? atStart.value : atEnd.value)) return;
  const style = getComputedStyle(t);
  const page = t.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const from = heading ?? t.scrollLeft;
  const to = Math.max(0, Math.min(t.scrollWidth - t.clientWidth, from + direction * page));
  heading = reduce ? null : to;
  clearTimeout(headingTimer);
  if (heading !== null) headingTimer = setTimeout(() => (heading = null), 800);
  t.scrollBy({ left: to - t.scrollLeft, behavior: reduce ? "auto" : "smooth" });
}
function arrived() {
  heading = null;
  measure();
}

let resize: ResizeObserver | null = null;
onMounted(() => {
  measure();
  resize = new ResizeObserver(measure);
  if (track.value) resize.observe(track.value);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  cancelAnimationFrame(frame);
  clearTimeout(headingTimer);
});
watch(() => props.items.length, () => nextTick(measure));
</script>

<template>
  <section :aria-labelledby="`${id}-heading`">
    <div class="flex items-center justify-between gap-3">
      <component :is="`h${headingLevel}`" :id="`${id}-heading`" class="text-lg font-semibold">{{ label }}</component>
      <div class="flex items-center gap-2">
        <slot name="header" />
        <button type="button" class="carousel-arrow" :aria-label="`Scroll ${label} left`" :aria-controls="`${id}-track`"
          :aria-disabled="atStart ? 'true' : undefined" @click="scrollPage(-1)">
          <Icon name="lucide:chevron-left" class="size-5" aria-hidden="true" />
        </button>
        <button type="button" class="carousel-arrow" :aria-label="`Scroll ${label} right`" :aria-controls="`${id}-track`"
          :aria-disabled="atEnd ? 'true' : undefined" @click="scrollPage(1)">
          <Icon name="lucide:chevron-right" class="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div class="mt-4">
    <ul :id="`${id}-track`" ref="track" role="list" class="carousel-track no-scrollbar" data-lenis-prevent-horizontal
      @scroll.passive="measure" @scrollend="arrived">
      <li v-for="item in items" :key="itemKey(item)" class="carousel-item">
        <slot name="item" :item="item" />
      </li>
      <li v-if="seeAll" class="carousel-item">
        <NuxtLink :to="seeAll.href" class="group focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-[3px]">
          <span class="bg-muted group-hover:bg-accent flex aspect-[4/3] items-center justify-center rounded-xl transition-colors">
            <Icon name="lucide:arrow-right" class="size-8" aria-hidden="true" />
          </span>
          <span class="mt-3 block font-medium">{{ seeAll.label }}</span>
        </NuxtLink>
      </li>
    </ul>
    </div>
  </section>
</template>

<style scoped>
.carousel-track {
  /* How many cards show, the gap between them, and the room at the sides:
     the page's 16px on phones and tablets (full bleed), 4px on desktop. */
  --per-view: 1.2;
  --gap: 1rem;
  --bleed: 1rem;
  --ring-room: 0.25rem;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: calc((100% - var(--gap) * (var(--per-view) - 1)) / var(--per-view));
  gap: var(--gap);
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scroll-snap-type: x mandatory;
  margin: calc(-1 * var(--ring-room)) calc(-1 * var(--bleed));
  padding: var(--ring-room) var(--bleed);
  scroll-padding-inline: var(--bleed);
}
.carousel-item {
  scroll-snap-align: start;
  min-width: 0;
}
@media (min-width: 640px) {
  .carousel-track {
    --per-view: 3;
  }
}
@media (min-width: 768px) {
  .carousel-track {
    --gap: 1.5rem;
  }
}
@media (min-width: 1024px) {
  .carousel-track {
    --per-view: 5;
    --bleed: var(--ring-room);
  }
}
.carousel-arrow {
  display: inline-flex;
  width: 2.75rem;
  height: 2.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--background);
  color: var(--foreground);
  transition: background-color 150ms, opacity 150ms;
}
.carousel-arrow:hover:not([aria-disabled="true"]) {
  background: var(--accent);
}
.carousel-arrow:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.carousel-arrow[aria-disabled="true"] {
  opacity: 0.4;
  cursor: default;
}
</style>
