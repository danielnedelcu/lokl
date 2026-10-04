<script setup lang="ts">
  // The one time-of-day field (docs/frontend.md): hour, minutes and AM/PM as
  // three dropdowns (each a SelectInput, ui-thing's UiSelect; docs/frontend.md,
  // Form controls), holding "HH:MM" (24-hour) in the form. Replaces
  // <input type="time">, whose value stays empty until every part is filled:
  // typing "6:30" without choosing AM or PM read as no time at all, so the
  // session form said "Choose a start time." (found 2026-10-02). Dropdowns
  // behave the same in every browser and on phones, work with the keyboard,
  // and a half-chosen time says what's missing.
  //
  // The field holds "" when nothing is chosen, INCOMPLETE_TIME when only
  // some parts are (schemas give it its own message), else "HH:MM".
  const props = withDefaults(
    defineProps<{
      name: string;
      label: string;
      hint?: string;
      required?: boolean;
      disabled?: boolean;
      /** Minutes between choices: 5 gives :00, :05 ... :55. */
      minuteStep?: number;
    }>(),
    { minuteStep: 5 },
  );

  // From the field's name, not useId(), as in DateInput: the same id on the
  // server and in the browser, so each dropdown keeps its label.
  const id = `field-${props.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const { value, errorMessage, handleBlur } = useField<string>(() => props.name);

  const hours = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  const minutes = computed(() =>
    Array.from({ length: Math.ceil(60 / props.minuteStep) }, (_, i) => {
      const m = String(i * props.minuteStep).padStart(2, "0");
      return { value: m, label: m };
    }),
  );
  const halves = [
    { value: "AM", label: "AM" },
    { value: "PM", label: "PM" },
  ];

  const hour = ref<string | null | undefined>("");
  const minute = ref<string | null | undefined>("");
  const half = ref<string | null | undefined>("");

  // From the form (a reset, or editing an existing time) to the dropdowns.
  watch(
    value,
    (v) => {
      const parts = fromTimeOfDay(v ?? "");
      if (parts) {
        hour.value = parts.hour;
        minute.value = parts.minute;
        half.value = parts.half;
      } else if (!v) {
        hour.value = minute.value = half.value = "";
      }
    },
    { immediate: true },
  );

  // From the dropdowns to the form.
  function update() {
    value.value = toTimeOfDay(hour.value ?? "", minute.value ?? "", (half.value ?? "") as "" | "AM" | "PM");
  }

  const describedBy = computed(() => (errorMessage.value ? `${id}-error` : props.hint ? `${id}-hint` : undefined));
</script>

<template>
  <fieldset class="w-full" :aria-describedby="describedBy" :aria-invalid="!!errorMessage || undefined">
    <legend :class="[errorMessage && 'text-destructive', 'mb-2 text-sm font-medium']">
      {{ label }} <span v-if="required" class="text-destructive">*</span>
    </legend>
    <div class="flex items-center gap-1.5">
      <label :for="`${id}-hour`" class="sr-only">Hour</label>
      <SelectInput :id="`${id}-hour`" v-model="hour" :options="hours" placeholder="Hour" class="w-24" touch
        :disabled="disabled" :invalid="!!errorMessage" @update:model-value="update" @blur="handleBlur" />
      <span aria-hidden="true">:</span>
      <label :for="`${id}-minute`" class="sr-only">Minutes</label>
      <SelectInput :id="`${id}-minute`" v-model="minute" :options="minutes" placeholder="Min" class="w-24" touch
        :disabled="disabled" :invalid="!!errorMessage" @update:model-value="update" @blur="handleBlur" />
      <label :for="`${id}-half`" class="sr-only">AM or PM</label>
      <SelectInput :id="`${id}-half`" v-model="half" :options="halves" placeholder="AM/PM" class="w-24" touch
        :disabled="disabled" :invalid="!!errorMessage" @update:model-value="update" @blur="handleBlur" />
    </div>
    <p v-if="hint && !errorMessage" :id="`${id}-hint`" class="text-muted-foreground mt-1.5 text-sm">{{ hint }}</p>
    <p v-if="errorMessage" :id="`${id}-error`" class="text-destructive mt-1.5 text-sm">{{ errorMessage }}</p>
  </fieldset>
</template>
