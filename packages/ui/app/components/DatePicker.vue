<script setup lang="ts">
// The one date field for both apps (docs/frontend.md, Form controls), built
// on Reka UI's DatePicker, the library under every ui-thing component (ui-
// thing's own date picker uses v-calendar, a second library). Decided
// 2026-10-03.
//
// - Type the month, day and year (arrow keys change the part you're in), or
//   open the calendar with the button: arrow keys move by day, Page Up and
//   Page Down by month, Enter chooses, Escape closes.
// - Screen readers hear the label (the group's), then each part by name.
// - Draws on the server; with `name`, Reka's hidden field submits
//   "YYYY-MM-DD" with a normal form (the browse filters).
// - Holds "YYYY-MM-DD", or "" when empty. Use DateInput in vee-validate forms.
import { parseDate, today, getLocalTimeZone, type DateValue } from "@internationalized/date";
import {
  DatePickerCalendar, DatePickerCell, DatePickerCellTrigger, DatePickerContent, DatePickerField, DatePickerGrid,
  DatePickerGridBody, DatePickerGridHead, DatePickerGridRow, DatePickerHeadCell, DatePickerHeader, DatePickerHeading,
  DatePickerInput, DatePickerNext, DatePickerPrev, DatePickerRoot, DatePickerTrigger,
} from "reka-ui";

const props = defineProps<{
  /** The id of the visible label (the field is a group of parts, not one input). */
  labelledby?: string;
  describedby?: string;
  name?: string;
  /** Earliest and latest choosable day, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** 44px tall, for touch targets on the website. */
  touch?: boolean;
}>();
const model = defineModel<string>({ default: "" });
const emit = defineEmits<{ blur: [] }>();

const toDate = (s: string | undefined) => {
  if (!s) return undefined;
  try {
    return parseDate(s);
  } catch {
    return undefined;
  }
};
const value = computed({
  get: () => toDate(model.value),
  set: (d: DateValue | undefined) => {
    model.value = d ? d.toString() : "";
  },
});
const minValue = computed(() => toDate(props.min));
const maxValue = computed(() => toDate(props.max));
// The calendar opens on the chosen month, or the earliest choosable one.
// shallowRef: a deep ref would unwrap the date object and lose its type.
const placeholder = shallowRef<DateValue>(value.value ?? minValue.value ?? today(getLocalTimeZone()));
watch(value, (v) => {
  if (v) placeholder.value = v;
});

// Reka's hidden form field (type="date", out of the Tab order) would be read
// out as an unnamed second date field; it's only there for the form, so it's
// hidden from screen readers too.
const wrap = ref<HTMLElement | null>(null);
onMounted(() => wrap.value?.querySelectorAll("input").forEach((i) => i.setAttribute("aria-hidden", "true")));

function onFocusOut(e: FocusEvent) {
  const root = e.currentTarget as HTMLElement;
  if (!root.contains(e.relatedTarget as Node | null)) emit("blur");
}
</script>

<template>
  <div ref="wrap" class="contents">
  <DatePickerRoot v-model="value" v-model:placeholder="placeholder" :name="name" :min-value="minValue" :max-value="maxValue"
    :disabled="disabled" locale="en-US" granularity="day" :week-starts-on="0" fixed-weeks close-on-select>
    <DatePickerField v-slot="{ segments }" :aria-labelledby="labelledby" :aria-describedby="describedby"
      :aria-invalid="invalid || undefined" :class="[
        'border-input bg-background flex w-full items-center rounded-md border pl-3 pr-1 text-sm shadow-xs',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        'aria-invalid:border-destructive data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        touch ? 'h-11' : 'h-9',
      ]" @focusout="onFocusOut">
      <div class="flex flex-1 items-center">
        <template v-for="item in segments" :key="item.part">
          <DatePickerInput v-if="item.part === 'literal'" :part="item.part" class="text-muted-foreground px-px">
            {{ item.value }}
          </DatePickerInput>
          <DatePickerInput v-else :part="item.part"
            class="focus:bg-accent focus:text-accent-foreground data-[placeholder]:text-muted-foreground rounded px-0.5 tabular-nums outline-none">
            {{ item.value }}
          </DatePickerInput>
        </template>
      </div>
      <DatePickerTrigger aria-label="Choose a date from the calendar"
        :class="['hover:bg-accent focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]', touch ? '-my-px -mr-1 h-11 w-11' : 'size-7']">
        <Icon name="lucide:calendar" class="size-4" aria-hidden="true" />
      </DatePickerTrigger>
    </DatePickerField>

    <DatePickerContent :side-offset="4" align="start" :collision-padding="16"
      class="bg-popover text-popover-foreground z-50 rounded-md border p-3 shadow-md outline-none">
      <DatePickerCalendar v-slot="{ weekDays, grid }">
        <DatePickerHeader class="flex items-center justify-between gap-2">
          <DatePickerPrev aria-label="Previous month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
          </DatePickerPrev>
          <DatePickerHeading class="text-sm font-medium" />
          <DatePickerNext aria-label="Next month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
          </DatePickerNext>
        </DatePickerHeader>
        <DatePickerGrid v-for="month in grid" :key="month.value.toString()" class="mt-3 w-full border-collapse select-none">
          <DatePickerGridHead>
            <DatePickerGridRow class="flex">
              <DatePickerHeadCell v-for="day in weekDays" :key="day" :class="['text-muted-foreground text-xs font-normal', touch ? 'w-11' : 'w-9']">
                {{ day }}
              </DatePickerHeadCell>
            </DatePickerGridRow>
          </DatePickerGridHead>
          <DatePickerGridBody>
            <DatePickerGridRow v-for="(week, i) in month.rows" :key="`week-${i}`" class="mt-1 flex">
              <DatePickerCell v-for="day in week" :key="day.toString()" :date="day" class="p-0 text-center">
                <DatePickerCellTrigger :day="day" :month="month.value" :class="touch ? 'size-11' : 'size-9'" class="hover:bg-accent focus-visible:ring-ring/50 inline-flex items-center justify-center rounded-md text-sm tabular-nums outline-none focus-visible:ring-[3px]
                  data-[today]:font-semibold data-[today]:underline data-[outside-view]:text-muted-foreground
                  data-[selected]:bg-primary data-[selected]:text-primary-foreground
                  data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40
                  data-[unavailable]:line-through" />
              </DatePickerCell>
            </DatePickerGridRow>
          </DatePickerGridBody>
        </DatePickerGrid>
      </DatePickerCalendar>
    </DatePickerContent>
  </DatePickerRoot>
  </div>
</template>
