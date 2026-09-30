<script setup lang="ts">
import type { DashboardNavSection } from "./DashboardNav.vue";

// The dashboards' menu on phones, where the sidebar is hidden: a button that
// opens the same links in a panel from the left. Closes when a page is picked.
defineProps<{
  title: string;
  sections: DashboardNavSection[];
  exactRoot: string;
  email?: string | null;
}>();
const emit = defineEmits<{ signOut: [] }>();

const open = ref(false);
const route = useRoute();
watch(() => route.fullPath, () => (open.value = false));
</script>

<template>
  <UiSheet v-model:open="open">
    <UiSheetTrigger as-child>
      <UiButton variant="ghost" size="icon-touch" class="md:hidden" aria-label="Open menu">
        <Icon name="lucide:menu" class="size-5" aria-hidden="true" />
      </UiButton>
    </UiSheetTrigger>
    <UiSheetContent side="left" class="flex w-72 max-w-[85vw] flex-col gap-0 p-0" :title="title" description="Pages">
      <template #header>
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <UiSheetTitle :title="title" class="text-base" />
          <UiSheetDescription description="Pages" class="sr-only" />
        </div>
      </template>
      <template #content>
        <div class="flex-1 overflow-y-auto px-3 py-4">
          <DashboardNav :sections="sections" :exact-root="exactRoot" @navigate="open = false" />
        </div>
        <div class="border-t border-border px-4 py-4 text-sm">
          <p v-if="email" class="text-muted-foreground truncate">{{ email }}</p>
          <UiButton variant="ghost" class="-mx-2 mt-1 px-2" @click="emit('signOut')">Sign out</UiButton>
        </div>
      </template>
      <!-- ui-thing's default close button renders empty (no icon or label). -->
      <template #close>
        <UiSheetClose as-child>
          <UiButton variant="ghost" size="icon-touch" class="absolute top-1.5 right-1.5" aria-label="Close menu">
            <Icon name="lucide:x" class="size-5" aria-hidden="true" />
          </UiButton>
        </UiSheetClose>
      </template>
    </UiSheetContent>
  </UiSheet>
</template>
