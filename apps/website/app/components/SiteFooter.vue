<script setup lang="ts">
// The public site's footer (docs/design/website-pages.md, "Footer"): four
// columns, each a heading and its links. A link appears only once its page
// exists. Two columns on a phone, four from tablets.
const columns: { title: string; links: { label: string; to: string }[] }[] = [
  { title: "lokl", links: [
    { label: "About", to: "/about" },
    { label: "How lokl works", to: "/how-lokl-works" },
    { label: "Atlanta guides", to: "/atlanta/guides" },
    { label: "Accessibility", to: "/accessibility" },
  ] },
  { title: "Customers", links: [
    { label: "Browse Experiences", to: "/atlanta/experiences" },
    { label: "Browse Services", to: "/atlanta/services" },
    { label: "Cancellation policy", to: "/cancellation-policy" },
    { label: "Review rules", to: "/review-rules" },
  ] },
  { title: "Hosts", links: [
    { label: "How hosting works", to: "/hosting" },
    { label: "Fees and payouts", to: "/fees" },
    { label: "Start hosting", to: "/dashboard" },
    { label: "Help for hosts", to: "/help/hosts" },
  ] },
  { title: "Support", links: [
    { label: "Help centre", to: "/help" },
    { label: "Contact", to: "/contact" },
    { label: "Safety", to: "/safety" },
    { label: "Terms", to: "/terms" },
    { label: "Privacy", to: "/privacy" },
  ] },
];
</script>

<template>
  <footer class="border-border text-muted-foreground border-t">
    <div class="mx-auto max-w-6xl px-4 py-10">
      <div class="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
        <nav v-for="col in columns" :key="col.title" :aria-labelledby="`footer-${col.title}`">
          <h2 :id="`footer-${col.title}`" class="text-foreground text-sm font-semibold">{{ col.title }}</h2>
          <ul class="mt-3 space-y-1 text-sm">
            <li v-for="l in col.links" :key="l.to">
              <!-- At least 24px tall (WCAG 2.5.8), with lokl's visible focus ring. -->
              <NuxtLink :to="l.to" class="hover:text-foreground focus-visible:ring-ring inline-flex min-h-6 items-center rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2">
                {{ l.label }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
      <p class="mt-10 text-sm">lokl · Services and Experiences from local people in Atlanta.</p>
    </div>
  </footer>
</template>
