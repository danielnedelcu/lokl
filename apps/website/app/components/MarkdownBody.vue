<script setup lang="ts">
// Text rendered from a Markdown file in content/ (Help centre articles and
// the information pages), with raw HTML switched off when it was rendered
// (helpArticle.ts): headings, paragraphs, lists, tables and links only.
defineProps<{ html: string }>();
</script>

<template>
  <div class="help-body" v-html="html" />
</template>

<style scoped>
.help-body {
  line-height: 1.7;
}
.help-body :deep(h2) {
  margin-top: 2rem;
  font-size: 1.125rem;
  font-weight: 600;
}
.help-body :deep(p),
.help-body :deep(ul),
.help-body :deep(ol),
.help-body :deep(table) {
  margin-top: 0.75rem;
}
.help-body :deep(ol) {
  list-style: decimal;
  padding-left: 1.5rem;
}
.help-body :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
}
.help-body :deep(li + li) {
  margin-top: 0.5rem;
}
.help-body :deep(strong) {
  font-weight: 600;
}
.help-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
.help-body :deep(th),
.help-body :deep(td) {
  border-bottom: 1px solid var(--color-border);
  padding: 0.5rem 0.75rem 0.5rem 0;
  text-align: left;
  vertical-align: top;
}
.help-body :deep(th) {
  font-weight: 600;
}
.help-body :deep(.help-table) {
  margin-top: 0.75rem;
  overflow-x: auto;
}
.help-body :deep(.help-table table) {
  margin-top: 0;
  min-width: 28rem;
}
</style>
