<!--
  lokl change (docs/frontend.md, WCAG 2.2 AA): the field is marked
  aria-invalid when it has an error, and aria-describedby points at the error
  text (or the hint when there's no error), each of which now has an id, so
  screen readers announce it with the field. Keep this if the component is
  re-added with the ui-thing CLI.
-->
<template>
  <div class="w-full">
    <UiLabel v-if="label" :for="inputId" :class="[errorMessage && 'text-destructive', 'mb-2']">
      <span>{{ label }} <span v-if="required" class="text-destructive">*</span></span>
    </UiLabel>
    <div class="relative">
      <slot name="icon">
        <span v-if="hasIcon" lass="absolute inset-y-0 left-3 flex items-center justify-center">
          <Icon v-if="icon" :name="icon" class="text-muted-foreground size-4" />
        </span>
      </slot>
      <UiNativeSelect
        :id="inputId"
        :aria-describedby="describedBy"
        v-model="value"
        :required="required"
        :trailing-icon="trailingIcon"
        :aria-invalid="!!errorMessage"
        :name="name"
        v-bind="$attrs"
        :class="[hasIcon && 'pl-9']"
        @blur="handleBlur"
      >
        <slot />
      </UiNativeSelect>
    </div>
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

  const variants = {
    initial: { opacity: 0, y: -2 },
    animate: { opacity: 1, y: 0 },
  };

  const props = defineProps<{
    label?: string;
    icon?: string;
    hint?: string;
    modelValue?: string;
    name?: string;
    id?: string;
    rules?: any;
    validateOnMount?: boolean;
    type?: string;
    trailingIcon?: string;
    required?: boolean;
  }>();

  const inputId = props.id || useId();
  // The error when there is one, otherwise the hint (lokl change, see top of file).
  const describedBy = computed(() =>
    errorMessage.value ? `${inputId}-error` : props.hint ? `${inputId}-hint` : undefined,
  );

  const hasIcon = computed(() => Boolean(props.icon) || Boolean(useSlots().icon));

  const { errorMessage, value, handleBlur } = useField(() => props.name || inputId, props.rules, {
    initialValue: props.modelValue,
    label: props.label,
    validateOnMount: props.validateOnMount,
    syncVModel: true,
  });
</script>
