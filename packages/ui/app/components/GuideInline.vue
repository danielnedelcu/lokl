<script setup lang="ts">
// A guide's inline text, drawn by inlineVNodes() (utils/guideInline.ts):
// escaped text with only bold, italic, line breaks and safe links.
const props = defineProps<{ html: string }>();
const Content = () => inlineVNodes(props.html);
</script>

<template>
  <Content />
</template>
