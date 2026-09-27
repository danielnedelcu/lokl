<script setup lang="ts">
definePageMeta({ layout: "dashboard" });
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Bookings</h1>
    <p class="mt-1 text-sm text-muted-foreground">Upcoming and past bookings from customers.</p>
    <div class="mt-6 rounded-lg border border-dashed border-input bg-card p-10 text-center text-sm text-muted-foreground">
      No bookings yet.
    </div>
  </div>
</template>
