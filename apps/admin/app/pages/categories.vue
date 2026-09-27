<template>
  <div>
    <PageHeader
      title="Categories"
      description="Service and Experience categories. Only admins can create or change these."
    >
      <template #actions>
        <UiButton size="sm" disabled>New category</UiButton>
      </template>
    </PageHeader>
    <EmptyState
      icon="lucide:tags"
      title="No categories yet"
      description="Create categories before inviting providers so they can file their listings."
    />
  </div>
</template>
