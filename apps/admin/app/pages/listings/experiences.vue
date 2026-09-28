<script setup lang="ts">
useHead({ title: "Experiences · Admin" });

// The review queue opens first whenever something is waiting.
const queueCount = ref<number | null>(null);
const tab = ref("queue");
watch(queueCount, (n, before) => {
  if (before === null && n === 0) tab.value = "all";
});
</script>

<template>
  <div>
    <PageHeader
      title="Experiences"
      description="Curated listings from individuals and businesses. Each one is reviewed before it goes live."
    />
    <UiTabs v-model="tab">
      <UiTabsList>
        <UiTabsTrigger value="queue">Review queue{{ queueCount === null ? "" : ` (${queueCount})` }}</UiTabsTrigger>
        <UiTabsTrigger value="all">All Experiences</UiTabsTrigger>
      </UiTabsList>
      <UiTabsContent value="queue" class="mt-4" :force-mount="true" :hidden="tab !== 'queue'">
        <ReviewQueue @count="queueCount = $event" />
      </UiTabsContent>
      <UiTabsContent value="all" class="mt-4">
        <ListingsTable kind="experience" />
      </UiTabsContent>
    </UiTabs>
  </div>
</template>
