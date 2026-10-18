<script setup lang="ts">
// Six boxes for a code (docs/design/sign-in-with-code.md), shared by the
// sign-in form and the admin app's authenticator pages: named as one group,
// each "Digit 1 of 6". otp: every box offers a one-time code from the
// device; a pasted or offered code fills them all, digits only, from the
// first. Backspace and the arrow keys move between boxes.
const digits = defineModel<number[]>({ default: () => [] });
const props = withDefaults(defineProps<{
  /** The id of the group's visible label. */
  labelledby: string;
  /** The first box's id (for focusing it and for a label's `for`). */
  id?: string;
  describedby?: string;
  invalid?: boolean;
  disabled?: boolean;
  length?: number;
}>(), { id: undefined, describedby: undefined, invalid: false, disabled: false, length: 6 });
const emit = defineEmits<{ complete: [] }>();
</script>

<template>
  <UiPinInput v-model="digits" :input-count="props.length" otp type="number" :disabled="props.disabled"
    role="group" :aria-labelledby="props.labelledby" class="justify-between gap-1.5 sm:justify-start sm:gap-2" @complete="emit('complete')">
    <UiPinInputInput v-for="(_, i) in props.length" :id="i === 0 ? props.id : undefined" :key="i" :index="i"
      :aria-label="`Digit ${i + 1} of ${props.length}`" :aria-invalid="props.invalid || undefined" :aria-describedby="props.describedby"
      class="h-12 w-11 font-mono text-xl sm:w-12" />
  </UiPinInput>
</template>
