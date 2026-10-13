<script setup lang="ts">
import { parseDate, type DateValue } from "@internationalized/date";
import { useMediaQuery } from "@vueuse/core";
import {
  RangeCalendarCell, RangeCalendarCellTrigger, RangeCalendarGrid, RangeCalendarGridBody, RangeCalendarGridHead,
  RangeCalendarGridRow, RangeCalendarHeadCell, RangeCalendarHeader, RangeCalendarHeading, RangeCalendarNext,
  RangeCalendarPrev, RangeCalendarRoot,
} from "reka-ui";

// The search's When panel (docs/design/search.md): Today, Tomorrow and This
// weekend on the left, each with its dates, and a range calendar on the
// right (Reka's, like DateRangePicker; ui-thing's is v-calendar). Every date
// is the market's ("Atlanta time"), never the device's: today, the quick
// dates and the earliest choosable day all come from `timeZone`, and today
// is marked from that, not from Reka's data-today (the device's day).
// One day, or a range: a day alone counts as that day. Dates filter
// Experiences only; the note says so.
const props = defineProps<{ timeZone: string; zoneLabel: string }>();
const model = defineModel<{ from?: string; to?: string }>({ required: true });
const emit = defineEmits<{ chosen: [] }>();

const quick = computed(() => quickDates(props.timeZone));
const options = computed(() => [
  { key: "today", label: "Today", range: { from: quick.value.today, to: quick.value.today }, dates: quick.value.labels.today },
  { key: "tomorrow", label: "Tomorrow", range: { from: quick.value.tomorrow, to: quick.value.tomorrow }, dates: quick.value.labels.tomorrow },
  { key: "weekend", label: "This weekend", range: quick.value.weekend, dates: quick.value.labels.weekend },
]);
const isQuick = (r: { from: string; to: string }) => model.value.from === r.from && (model.value.to ?? model.value.from) === r.to;
function pick(r: { from: string; to: string }) {
  model.value = { ...model.value, ...r };
  placeholder.value = parseDate(r.from);
  emit("chosen");
}

const value = computed({
  get: () => ({ start: model.value.from ? parseDate(model.value.from) : undefined, end: model.value.to ? parseDate(model.value.to) : undefined }),
  set: (r: { start?: DateValue; end?: DateValue }) => {
    // One day is a choice on its own (shown at once); a second day makes a
    // range. Neither moves on to What: only a quick date does (2026-10-12).
    model.value = { ...model.value, from: r.start?.toString(), to: r.end?.toString() };
  },
});
// shallowRef: a deep ref would unwrap the date object and lose its type.
const placeholder = shallowRef<DateValue>(parseDate(model.value.from ?? quick.value.today));
const wide = useMediaQuery("(min-width: 768px)");
const quickBtn = "flex w-full flex-col items-start rounded-2xl border border-border px-4 py-3 text-left outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";
</script>

<template>
  <div class="flex flex-col gap-6 md:flex-row">
    <div class="grid shrink-0 grid-cols-1 content-start gap-2 self-start sm:grid-cols-3 md:w-48 md:grid-cols-1" role="group" aria-label="Quick dates">
      <button v-for="o in options" :key="o.key" type="button" :class="quickBtn" :aria-pressed="isQuick(o.range)" @click="pick(o.range)">
        <span class="inline-flex items-center font-semibold"><Icon v-if="isQuick(o.range)" name="lucide:check" class="mr-1.5 size-4" aria-hidden="true" />{{ o.label }}</span>
        <span class="text-sm opacity-80">{{ o.dates }}</span>
      </button>
    </div>
    <div>
      <RangeCalendarRoot v-slot="{ weekDays, grid }" v-model="value" v-model:placeholder="placeholder" :min-value="parseDate(quick.today)"
        locale="en-US" :week-starts-on="0" fixed-weeks :number-of-months="wide ? 2 : 1" :aria-label="`Dates, ${zoneLabel}`">
        <RangeCalendarHeader class="flex items-center justify-between gap-2">
          <RangeCalendarPrev aria-label="Previous month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-left" class="size-4" aria-hidden="true" />
          </RangeCalendarPrev>
          <RangeCalendarHeading class="text-sm font-semibold" />
          <RangeCalendarNext aria-label="Next month"
            class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-40">
            <Icon name="lucide:chevron-right" class="size-4" aria-hidden="true" />
          </RangeCalendarNext>
        </RangeCalendarHeader>
        <div class="mt-2 flex flex-col gap-6 md:flex-row">
          <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()" class="border-collapse select-none">
            <RangeCalendarGridHead>
              <RangeCalendarGridRow class="flex">
                <RangeCalendarHeadCell v-for="day in weekDays" :key="day" class="text-muted-foreground w-10 text-xs font-normal">{{ day }}</RangeCalendarHeadCell>
              </RangeCalendarGridRow>
            </RangeCalendarGridHead>
            <RangeCalendarGridBody>
              <RangeCalendarGridRow v-for="(week, i) in month.rows" :key="`week-${i}`" class="flex">
                <RangeCalendarCell v-for="day in week" :key="day.toString()" :date="day" class="p-0 text-center">
                  <RangeCalendarCellTrigger :day="day" :month="month.value" :data-market-today="day.toString() === quick.today ? '' : undefined"
                    class="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-10 items-center justify-center rounded-full text-sm tabular-nums outline-none focus-visible:ring-[3px]
                      data-[market-today]:font-bold data-[market-today]:underline data-[outside-view]:invisible
                      data-[highlighted]:bg-accent data-[selected]:bg-accent
                      data-[selection-start]:bg-primary data-[selection-start]:text-primary-foreground
                      data-[selection-end]:bg-primary data-[selection-end]:text-primary-foreground
                      data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40" />
                </RangeCalendarCell>
              </RangeCalendarGridRow>
            </RangeCalendarGridBody>
          </RangeCalendarGrid>
        </div>
      </RangeCalendarRoot>
      <p class="text-muted-foreground mt-3 max-w-md text-sm">
        Dates apply to Experiences, in {{ zoneLabel }}. For Services, you suggest times when you book.
      </p>
    </div>
  </div>
</template>
