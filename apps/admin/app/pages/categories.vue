<template>
  <div>
    <PageHeader
      title="Categories"
      description="Service and Experience categories. Only admins can create or change these."
    >
      <template #actions>
        <button type="button" class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white" disabled>
          New category
        </button>
      </template>
    </PageHeader>
    <EmptyState
      icon="lucide:tags"
      title="No categories yet"
      description="Create categories before inviting providers so they can file their listings."
    />
  </div>
</template>
