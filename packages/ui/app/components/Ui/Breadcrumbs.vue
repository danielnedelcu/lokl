<!--
  lokl changes (2026-10-17; docs/frontend.md). Keep them if the component is
  re-added with the ui-thing CLI, whose version is a <nav> of <div>s:
  - Accessible breadcrumb pattern (WAI-ARIA APG): a <nav> labelled
    "Breadcrumb" holding an ordered list; each earlier page a link, the
    current page plain text with aria-current="page" (never a link); the
    separators aria-hidden, so screen readers read only the pages.
  - lokl's text links (link-text): no border or button background, a
    visible 2px focus ring, and each link at least 24px tall (WCAG 2.5.8).
-->
<template>
  <nav data-slot="breadcrumb" aria-label="Breadcrumb" :class="styles({ class: normalizeClass(props.class) || undefined })">
    <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <li v-for="(item, i) in items" :key="i" data-slot="breadcrumb-item" class="flex items-center gap-1.5">
        <!-- An earlier page is a link; the current page is text, on one line (a long
             title is cut short on screen; screen readers get it all). -->
        <NuxtLink
          v-if="isNotLastItem(i) && item.link && !item.disabled"
          :to="item.link"
          data-slot="breadcrumb-label"
          class="link-text focus-visible:ring-ring inline-flex min-h-6 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          @click="item?.click?.()"
        >
          {{ item.label }}
        </NuxtLink>
        <span v-else data-slot="breadcrumb-label" :aria-current="isNotLastItem(i) ? undefined : 'page'"
          class="line-clamp-1 py-0.5" :class="isNotLastItem(i) ? 'text-muted-foreground' : 'text-foreground'">
          {{ item.label }}
        </span>
        <Icon v-if="isNotLastItem(i)" data-slot="breadcrumb-separator" :name="separator" aria-hidden="true" class="text-muted-foreground size-3.5" />
      </li>
    </ol>
  </nav>
</template>

<script lang="ts">
  import { normalizeClass } from "vue";
</script>

<script setup lang="ts">
  import type { HTMLAttributes } from "vue";

  export interface BreadcrumbItem {
    label?: string;
    icon?: string;
    link?: string;
    disabled?: boolean;
    slot?: string;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    click?: Function;
  }

  const props = withDefaults(
    defineProps<{
      /** The pages, from the top to the current one (the last, which isn't a link). */
      items?: BreadcrumbItem[];
      /** The separator icon between pages (hidden from screen readers). */
      separator?: string;
      /** Custom class(es) to add to the parent element. */
      class?: HTMLAttributes["class"];
    }>(),
    {
      separator: "lucide:chevron-right",
      items: () => [],
    }
  );

  /**
   * Detects if the current item is not the last item in the breadcrumbs.
   *
   * @param index - The index of the current item.
   */
  const isNotLastItem = (index: number) => {
    return index !== props?.items?.length - 1;
  };

  const styles = tv({
    base: "w-full text-sm wrap-break-word",
  });
</script>
