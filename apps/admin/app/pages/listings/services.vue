<script setup lang="ts">
useHead({ title: "Services · Admin" });
</script>

<template>
  <div>
    <PageHeader
      title="Services"
      description="Listings providers publish themselves once their payouts are ready. Open one to take it down or restore it."
    />
    <ListingsTable kind="service" />
  </div>
</template>
