<script setup lang="ts">
defineProps<{ icon: string; title: string; description?: string }>();
</script>

<template>
  <div class="rounded-lg border border-dashed border-border bg-card p-10 text-center">
    <Icon :name="icon" class="mx-auto size-8 text-muted-foreground" />
    <p class="mt-3 font-medium">{{ title }}</p>
    <p v-if="description" class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
      {{ description }}
    </p>
  </div>
</template>
