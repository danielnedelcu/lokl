<!--
  lokl changes (docs/frontend.md). Keep them if the component is re-added
  with the ui-thing CLI, whose version wraps the native select:
  - Form controls (2026-10-03): wraps the shared SelectInput (ui-thing's
    UiSelect, Reka Select) instead of UiNativeSelect, so choices are passed
    as `options` ({ value, label, group? }) rather than <option> children.
  - WCAG 2.2 AA: the field is marked aria-invalid when it has an error, and
    aria-describedby points at the error text (or the hint when there's no
    error), each of which has an id, so screen readers announce it with the
    field.
-->
<template>
  <div class="w-full">
    <UiLabel v-if="label" :for="inputId" :class="[errorMessage && 'text-destructive', 'mb-2']">
      <span>{{ label }} <span v-if="required" class="text-destructive">*</span></span>
    </UiLabel>
    <SelectInput
      :id="inputId"
      v-model="value"
      :options="options"
      :placeholder="placeholder"
      :disabled="disabled"
      :invalid="!!errorMessage"
      :describedby="describedBy"
      :touch="touch"
      @blur="handleBlur"
    />
    <AnimatePresence multiple as="div" mode="wait">
      <slot name="hint" :error-message="errorMessage" :value>
        <motion.p
          v-if="hint && !errorMessage"
          :id="`${inputId}-hint`"
          :variants
          initial="initial"
          exit="initial"
          animate="animate"
          :transition="{ type: 'keyframes' }"
          class="text-muted-foreground mt-1.5 text-sm"
        >
          {{ hint }}
        </motion.p>
      </slot>
      <slot name="errorMessage" :error-message="errorMessage" :value>
        <motion.p
          v-if="errorMessage"
          :id="`${inputId}-error`"
          :variants
          initial="initial"
          exit="initial"
          animate="animate"
          :transition="{ type: 'keyframes' }"
          class="text-destructive mt-1.5 text-sm"
        >
          {{ errorMessage }}
        </motion.p>
      </slot>
    </AnimatePresence>
  </div>
</template>

<script lang="ts" setup>
  import { AnimatePresence, motion } from "motion-v";
  import type { SelectOption } from "../../../utils/selectOption";

  const variants = {
    initial: { opacity: 0, y: -2 },
    animate: { opacity: 1, y: 0 },
  };

  const props = defineProps<{
    label?: string;
    hint?: string;
    modelValue?: string | null;
    name?: string;
    id?: string;
    rules?: any;
    validateOnMount?: boolean;
    required?: boolean;
    disabled?: boolean;
    options: SelectOption[];
    placeholder?: string;
    /** 44px tall, for touch targets on the website. */
    touch?: boolean;
  }>();

  const inputId = props.id || useId();
  // The error when there is one, otherwise the hint (lokl change, see top of file).
  const describedBy = computed(() =>
    errorMessage.value ? `${inputId}-error` : props.hint ? `${inputId}-hint` : undefined,
  );

  const { errorMessage, value, handleBlur } = useField<string | null | undefined>(() => props.name || inputId, props.rules, {
    initialValue: props.modelValue,
    label: props.label,
    validateOnMount: props.validateOnMount,
    syncVModel: true,
  });
</script>
