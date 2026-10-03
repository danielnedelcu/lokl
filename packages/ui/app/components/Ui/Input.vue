<!-- eslint-disable vue/html-self-closing -->
<!--
  lokl change (2026-10-03): the field's background is the page's background
  colour (bg-background, white in the light theme), not transparent, so every
  input and select looks the same on grey admin pages; search fields also
  drop the browser's native look (appearance-none), which Safari draws grey.
  Placeholders use the full muted text colour, not 70% of it, which read as
  greyed out and fell below 4.5:1 contrast. Keep all three if the component
  is re-added with the ui-thing CLI.
-->
<template>
  <input
    v-bind="props"
    ref="input"
    data-slot="input"
    :class="styles({ class: normalizeClass(props.class) || undefined, type: props.type as any })"
    :value="modelValue"
    @input="handleInput"
  />
</template>

<script lang="ts">
  import { normalizeClass } from "vue";
  import type { HTMLAttributes, InputHTMLAttributes } from "vue";

  export type InputProps = {
    /** Additional classes to add to the input. */
    class?: HTMLAttributes["class"];
    /** The id of the input. */
    id?: string;
    /** The name of the input. */
    name?: string;
    /** The placeholder of the input. */
    placeholder?: string;
    /** Whether the input is disabled. */
    disabled?: boolean;
    /** Whether the input is required. */
    required?: boolean;
    /** The type of the input. */
    type?: InputHTMLAttributes["type"];
    /** The value of the input. */
    modelValue?: any;
    /** The maximum length of the input. */
    maxlength?: number;
    /** The `RegExp` pattern of the input. */
    pattern?: string;
    /** When `true`, the input will be focused when mounted. */
    autofocus?: boolean;
  };
</script>

<script lang="ts" setup>
  const props = withDefaults(defineProps<InputProps>(), {
    type: "text",
    modelValue: "",
  });

  const inputRef = useTemplateRef("input");

  const emit = defineEmits<{
    "update:modelValue": [value: string];
  }>();

  const handleInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    let value = target.value;

    /* val input with pattern */
    if (props.pattern) {
      const regex = new RegExp(props.pattern);
      value = Array.from(value)
        .filter((char) => regex.test(char))
        .join("");
    }

    /* Handle maxlength */
    if (props.maxlength) {
      value = value.slice(0, props.maxlength);
    }

    target.value = value;
    emit("update:modelValue", value);
  };

  const styles = tv({
    base: [
      "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border bg-background px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
      "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    ],
    variants: {
      type: {
        // lokl change: appearance-none, or Safari draws its own native search-field
        // background and ignores bg-background (2026-10-03).
        search:
          "appearance-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
        file: "text-muted-foreground/70 file:border-input file:text-foreground p-0 pr-3 italic file:me-3 file:h-full file:border-0 file:border-r file:border-solid file:bg-transparent file:px-3 file:text-sm file:font-medium file:not-italic",
      },
    },
  });

  onMounted(() => {
    if (props.autofocus) {
      inputRef.value?.focus();
    }
  });

  defineExpose({ inputRef });
</script>
