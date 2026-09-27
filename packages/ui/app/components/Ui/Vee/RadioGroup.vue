<!--
  lokl change (docs/frontend.md, WCAG 2.2 AA): the field is marked
  aria-invalid when it has an error, and aria-describedby points at the error
  text (or the hint when there's no error), each of which now has an id, so
  screen readers announce it with the field. The visible label now names the group
  (aria-labelledby), which it didn't before. Keep this if the component
  is re-added with the ui-thing CLI.
-->
<template>
  <div :class="styles({ class: normalizeClass(props.class) || undefined })">
    <slot name="label" :error-message="errorMessage" :value="value">
      <UiLabel
        v-if="label"
        :id="`${groupId}-label`"
        class="mb-5 leading-none"
        :class="[errorMessage && 'text-destructive']"
        ><span>{{ label }} <span v-if="required" class="text-destructive">*</span></span></UiLabel
      >
    </slot>
    <UiRadioGroup
      v-bind="{ ...forwarded, ...$attrs }"
      v-model="value"
      :aria-labelledby="label ? `${groupId}-label` : undefined"
      :aria-invalid="!!errorMessage || undefined"
      :aria-describedby="describedBy"
    >
      <slot />
    </UiRadioGroup>
    <AnimatePresence multiple as="div" mode="wait">
      <slot name="hint" :error-message="errorMessage" :value>
        <motion.p
          v-if="hint && !errorMessage"
          :id="`${groupId}-hint`"
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
          :id="`${groupId}-error`"
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
  import { useForwardProps } from "reka-ui";
  import type { RadioGroupRootProps } from "reka-ui";
  import { normalizeClass } from "vue";
  import type { HTMLAttributes } from "vue";

  const variants = {
    initial: { opacity: 0, y: -2 },
    animate: { opacity: 1, y: 0 },
  };

  const props = defineProps<
    RadioGroupRootProps & {
      label?: string;
      hint?: string;
      id?: string;
      rules?: any;
      validateOnMount?: boolean;
      class?: HTMLAttributes["class"];
      name: string;
    }
  >();

  const forwarded = useForwardProps(props);
  const groupId = useId();
  // The error when there is one, otherwise the hint (lokl change, see top of file).
  const describedBy = computed(() =>
    errorMessage.value ? `${groupId}-error` : props.hint ? `${groupId}-hint` : undefined,
  );
  const styles = tv({
    base: "flex flex-col",
  });

  defineOptions({ inheritAttrs: false });

  const { errorMessage, value } = useField(() => props.name, props.rules, {
    initialValue: props.modelValue,
    label: props.label,
    validateOnMount: props.validateOnMount,
    type: "radio",
    syncVModel: true,
  });
</script>
