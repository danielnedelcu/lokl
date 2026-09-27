<script setup lang="ts">
  // The one price input (docs/frontend.md): the person types dollars, the
  // form field holds cents. Built on ui-thing's CurrencyInput, with the same
  // label, hint, error and aria wiring as the Vee fields.
  const props = defineProps<{
    name: string;
    label: string;
    hint?: string;
    required?: boolean;
    disabled?: boolean;
    id?: string;
  }>();

  const inputId = props.id || useId();
  const { value: cents, errorMessage, handleBlur } = useField<number | null>(() => props.name);

  const dollars = computed({
    get: () => (cents.value == null ? null : cents.value / 100),
    set: (d: number | null) => {
      cents.value = d == null ? null : Math.round(d * 100);
    },
  });

  const describedBy = computed(() =>
    errorMessage.value ? `${inputId}-error` : props.hint ? `${inputId}-hint` : undefined,
  );
</script>

<template>
  <div class="w-full">
    <UiLabel :for="inputId" :class="[errorMessage && 'text-destructive', 'mb-2']">
      <span>{{ label }} <span v-if="required" class="text-destructive">*</span></span>
    </UiLabel>
    <UiCurrencyInput
      :id="inputId"
      v-model="dollars"
      :name="name"
      :required="required"
      :disabled="disabled"
      inputmode="decimal"
      :aria-invalid="!!errorMessage || undefined"
      :aria-describedby="describedBy"
      :options="{ currency: 'USD', precision: 2, valueRange: { min: 0 } }"
      @blur="handleBlur"
    />
    <p v-if="hint && !errorMessage" :id="`${inputId}-hint`" class="text-muted-foreground mt-1.5 text-sm">
      {{ hint }}
    </p>
    <p v-if="errorMessage" :id="`${inputId}-error`" class="text-destructive mt-1.5 text-sm">
      {{ errorMessage }}
    </p>
  </div>
</template>
