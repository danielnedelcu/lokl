<template>
  <div>
    <PageHeader
      title="Destination guides"
      description="City, neighborhood, and event content. Draft with AI, edit, then publish to the website."
    >
      <template #actions>
        <button type="button" class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white" disabled>
          New guide
        </button>
      </template>
    </PageHeader>
    <EmptyState
      icon="lucide:map"
      title="No guides yet"
      description="Guides link readers straight to bookable listings in the same city or category."
    />
  </div>
</template>
