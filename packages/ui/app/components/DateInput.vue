<script setup lang="ts">
// DatePicker in a vee-validate form, with its label, hint and error, like
// TimeInput (docs/frontend.md, Form controls). The field holds "YYYY-MM-DD",
// or "" when empty.
const props = defineProps<{
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  /** 44px tall, for touch targets on the website. */
  touch?: boolean;
}>();

const id = useId();
const { value, errorMessage, handleBlur } = useField<string>(() => props.name);
const describedBy = computed(() => (errorMessage.value ? `${id}-error` : props.hint ? `${id}-hint` : undefined));
</script>

<template>
  <div class="w-full">
    <p :id="`${id}-label`" :class="[errorMessage && 'text-destructive', 'mb-2 text-sm font-medium']">
      {{ label }} <span v-if="required" class="text-destructive" aria-hidden="true">*</span>
    </p>
    <DatePicker v-model="value" :labelledby="`${id}-label`" :describedby="describedBy" :min="min" :max="max"
      :disabled="disabled" :invalid="!!errorMessage" :touch="touch" @blur="handleBlur" />
    <p v-if="hint && !errorMessage" :id="`${id}-hint`" class="text-muted-foreground mt-1.5 text-sm">{{ hint }}</p>
    <p v-if="errorMessage" :id="`${id}-error`" class="text-destructive mt-1.5 text-sm">{{ errorMessage }}</p>
  </div>
</template>
