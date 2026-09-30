<script setup lang="ts">
// The dashboard's navigation links, used twice per app: in the desktop
// sidebar and in the phone menu (DashboardMobileMenu), so the two can't drift.
export interface DashboardNavItem {
  to: string;
  label: string;
  icon: string;
}
export interface DashboardNavSection {
  /** Heading above the group; leave out for a single ungrouped list. */
  label?: string;
  items: DashboardNavItem[];
}

defineProps<{
  sections: DashboardNavSection[];
  /** The route that only highlights on an exact match (the overview). */
  exactRoot: string;
}>();
const emit = defineEmits<{ navigate: [] }>();

const activeClass = "bg-accent font-medium !text-foreground";
</script>

<template>
  <nav class="space-y-6">
    <div v-for="(section, i) in sections" :key="section.label ?? i">
      <p v-if="section.label" class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
        {{ section.label }}
      </p>
      <NuxtLink
        v-for="item in section.items"
        :key="item.to"
        :to="item.to"
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex min-h-11 items-center gap-3 rounded-md px-2 text-sm md:min-h-0 md:gap-2 md:py-1.5"
        :active-class="item.to === exactRoot ? '' : activeClass"
        :exact-active-class="activeClass"
        @click="emit('navigate')"
      >
        <Icon :name="item.icon" class="size-4" aria-hidden="true" />
        {{ item.label }}
      </NuxtLink>
    </div>
  </nav>
</template>
