<!--
  lokl changes (docs/frontend.md, Form controls and WCAG 2.2 AA). Keep them
  if the component is re-added with the ui-thing CLI:
  - The input is marked aria-invalid when there's an error, and
    aria-describedby points at the error (or the hint), which now have ids.
  - Leaving the field validates it (handleBlur), like the other fields.
  - `touch` makes it 44px tall, for touch targets on the website.
-->
<template>
  <div class="w-full">
    <UiLabel
      v-if="label"
      :for="inputId"
      :hint="labelHint"
      :class="[disabled && 'text-muted-foreground', errorMessage && 'text-destructive', 'mb-2']"
      ><span>{{ label }} <span v-if="required" class="text-destructive">*</span></span></UiLabel
    >
    <div class="relative">
      <UiNumberField
        v-bind="($attrs, props)"
        :id="inputId"
        v-model="value"
        :disabled="disabled"
        :required="required"
        :name="name"
        :class="touch && 'h-11'"
      >
        <template v-for="(_, slotName) in $slots" #[slotName]="scope">
          <slot :name="slotName" v-bind="scope" />
        </template>
        <template v-if="!$slots.input" #input>
          <UiNumberFieldInput :aria-invalid="!!errorMessage || undefined" :aria-describedby="describedBy" @blur="handleBlur" />
        </template>
      </UiNumberField>
    </div>
    <AnimatePresence as="div" multiple mode="wait">
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
    </AnimatePresence>
  </div>
</template>

<script lang="ts" setup>
  import { AnimatePresence, motion } from "motion-v";
  import type { NumberFieldRootProps } from "reka-ui";

  const variants = {
    initial: { opacity: 0, y: -2 },
    animate: { opacity: 1, y: 0 },
  };

  interface Props extends NumberFieldRootProps {
    /** The label to display above the field. */
    label?: string;
    /** The label hint to display next to the label. */
    labelHint?: string;
    /** Hint to display below the input field. */
    hint?: string;
    /** Whether the field is disabled. */
    disabled?: boolean;
    /** The name of the field, used for form submission. */
    name?: string;
    /** The id of the input element. */
    id?: string;
    /** Rules for the field validation. */
    rules?: any;
    /** Whether to validate the field on mount. */
    validateOnMount?: boolean;
    /** Whether the field is required. */
    required?: boolean;
    /** 44px tall, for touch targets on the website (lokl change). */
    touch?: boolean;
  }
  const props = defineProps<Props>();

  const inputId = computed(() => props.id || useId());

  const describedBy = computed(() =>
    errorMessage.value ? `${inputId.value}-error` : props.hint ? `${inputId.value}-hint` : undefined,
  );

  const { errorMessage, value, handleBlur } = useField(() => props.name || inputId.value, props.rules, {
    initialValue: props.modelValue,
    label: props.label,
    validateOnMount: props.validateOnMount,
    syncVModel: true,
  });
</script>
