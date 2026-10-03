<script setup lang="ts">
// A range of days in one control: a button showing the range ("Oct 3 – 10,
// 2026") that opens a calendar (docs/frontend.md, Form controls). Built on
// Reka UI's DateRangePicker, like DatePicker; not ui-thing's v-calendar
// date picker (decided 2026-10-03).
//
// - Choose the first day, then the last; two months side by side on wider
//   screens, one on a phone.
// - Keyboard: Enter or Space opens it; arrow keys move by day, Page Up and
//   Page Down by month; Enter chooses; Escape closes.
// - The button's name says what it is and what's chosen ("Dates: Oct 3 – 10,
//   2026"), so screen readers don't need a separate label.
// - Holds { start, end } as "YYYY-MM-DD", "" when not set.
import { getLocalTimeZone, parseDate, today, type DateValue } from "@internationalized/date";
import { useMediaQuery } from "@vueuse/core";
import {
  DateRangePickerCalendar, DateRangePickerCell, DateRangePickerCellTrigger, DateRangePickerContent, DateRangePickerGrid,
  DateRangePickerGridBody, DateRangePickerGridHead, DateRangePickerGridRow, DateRangePickerHeadCell, DateRangePickerHeader,
  DateRangePickerHeading, DateRangePickerNext, DateRangePickerPrev, DateRangePickerRoot, DateRangePickerTrigger,
} from "reka-ui";

const props = withDefaults(
  defineProps<{
    /** The button fills its container below xl (a form column); the text starts at the left. */
    fullWidth?: boolean;
    /** What the range is for, in the button's name: "Dates", "Booked between". */
    label?: string;
    /** Shown on the button when no range is chosen. */
    emptyText?: string;
    min?: string;
    max?: string;
    disabled?: boolean;
    /** 44px tall, for touch targets on the website. */
    touch?: boolean;
  }>(),
  { label: "Dates", emptyText: "Any dates" },
);
const model = defineModel<{ start: string; end: string }>({ default: () => ({ start: "", end: "" }) });

const toDate = (s: string | undefined) => {
  if (!s) return undefined;
  try {
    return parseDate(s);
  } catch {
    return undefined;
  }
};
const value = computed({
  get: () => ({ start: toDate(model.value.start), end: toDate(model.value.end) }),
  set: (r: { start?: DateValue; end?: DateValue }) => {
    model.value = { start: r.start?.toString() ?? "", end: r.end?.toString() ?? "" };
  },
});
const chosen = computed(() => !!(model.value.start && model.value.end));
const text = computed(() => (chosen.value ? formatDateRange(model.value.start, model.value.end) : props.emptyText));
// shallowRef: a deep ref would unwrap the date object and lose its type.
const placeholder = shallowRef<DateValue>(value.value.start ?? today(getLocalTimeZone()));
const wide = useMediaQuery("(min-width: 640px)");
const open = ref(false);

function clear() {
  model.value = { start: "", end: "" };
  open.value = false;
}
</script>

<template>
  <DateRangePickerRoot v-model="value" v-model:placeholder="placeholder" v-model:open="open" :min-value="toDate(min)"
    :max-value="toDate(max)" :disabled="disabled" locale="en-US" :week-starts-on="0" fixed-weeks
    :number-of-months="wide ? 2 : 1" close-on-select>
    <DateRangePickerTrigger as-child>
      <!-- The same height as SelectInput and SearchSelect beside it (h-9), or 44px with `touch`. -->
      <UiButton variant="outline" :size="touch ? 'touch' : 'default'" class="gap-2 font-normal"
        :class="fullWidth && 'w-full min-w-0 justify-start xl:w-auto'"
        :aria-label="`${label}: ${text}`">
        <Icon name="lucide:calendar-range" class="text-muted-foreground size-4" aria-hidden="true" />
        <span class="truncate">{{ text }}</span>
      </UiButton>
    </DateRangePickerTrigger>

    <DateRangePickerContent :side-offset="4" align="start" :collision-padding="16"
      class="bg-popover text-popover-foreground z-50 rounded-md border p-3 shadow-md outline-none">
      <DateRangePickerCalendar v-slot="{ weekDays, grid }">
        <DateRangePickerHeader class="flex items-center justify-between gap-2">
          <DateRangePickerPrev aria-label="Previous month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
          </DateRangePickerPrev>
          <DateRangePickerHeading class="text-sm font-medium" />
          <DateRangePickerNext aria-label="Next month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
          </DateRangePickerNext>
        </DateRangePickerHeader>
        <div class="mt-3 flex flex-col gap-4 sm:flex-row">
          <DateRangePickerGrid v-for="month in grid" :key="month.value.toString()" class="border-collapse select-none">
            <DateRangePickerGridHead>
              <DateRangePickerGridRow class="flex">
                <DateRangePickerHeadCell v-for="day in weekDays" :key="day" class="text-muted-foreground w-9 text-xs font-normal">
                  {{ day }}
                </DateRangePickerHeadCell>
              </DateRangePickerGridRow>
            </DateRangePickerGridHead>
            <DateRangePickerGridBody>
              <DateRangePickerGridRow v-for="(week, i) in month.rows" :key="`week-${i}`" class="mt-1 flex">
                <DateRangePickerCell v-for="day in week" :key="day.toString()" :date="day" class="p-0 text-center">
                  <DateRangePickerCellTrigger :day="day" :month="month.value" class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-md text-sm tabular-nums outline-none focus-visible:ring-[3px]
                    data-[today]:font-semibold data-[today]:underline data-[outside-view]:invisible
                    data-[highlighted]:bg-accent data-[selected]:bg-accent
                    data-[selection-start]:bg-primary data-[selection-start]:text-primary-foreground
                    data-[selection-end]:bg-primary data-[selection-end]:text-primary-foreground
                    data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40" />
                </DateRangePickerCell>
              </DateRangePickerGridRow>
            </DateRangePickerGridBody>
          </DateRangePickerGrid>
        </div>
      </DateRangePickerCalendar>
      <div v-if="chosen" class="border-border mt-3 flex justify-end border-t pt-3">
        <UiButton size="sm" variant="ghost" @click="clear">Clear dates</UiButton>
      </div>
    </DateRangePickerContent>
  </DateRangePickerRoot>
</template>
