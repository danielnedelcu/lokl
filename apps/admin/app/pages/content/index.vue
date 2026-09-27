<template>
  <div>
    <PageHeader
      title="Destination guides"
      description="City, neighborhood, and event content. Draft with AI, edit, then publish to the website."
    >
      <template #actions>
        <UiButton size="sm" disabled>New guide</UiButton>
      </template>
    </PageHeader>
    <EmptyState
      icon="lucide:map"
      title="No guides yet"
      description="Guides link readers straight to bookable listings in the same city or category."
    />
  </div>
</template>
