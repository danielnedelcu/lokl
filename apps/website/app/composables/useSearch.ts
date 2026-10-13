import { areaLabel, readSearch, type PublicMarketInfo, type SearchFilters } from "@repo/types";

// The header search's state (docs/design/search.md), shared by the bar, the
// phone panel and the results page: what's chosen so far (the draft), the
// market's areas and categories, and each segment's value as shown. On the
// results page the draft follows the page's address, so the bar always
// shows the search on screen; elsewhere it keeps what was last chosen.
export function useSearch() {
  const route = useRoute();
  // Atlanta is the only market for now; a market's own pages search it.
  const marketSlug = computed(() => (typeof route.params.market === "string" ? route.params.market : "atlanta"));
  const draft = useState<SearchFilters>("search-draft", () => ({}));
  const { data: info } = useFetch<PublicMarketInfo>(() => `/api/public/markets/${marketSlug.value}`, {
    key: `public-market-${marketSlug.value}`,
  });

  const onResults = computed(() => route.path === `/${marketSlug.value}/search`);
  watch(() => (onResults.value ? route.fullPath : null), (path) => {
    if (path) draft.value = { ...readSearch(route.query), page: undefined };
  }, { immediate: true });

  const marketName = computed(() => info.value?.market.name ?? "Atlanta");
  const whereValue = computed(() => {
    const a = info.value?.areas.find((x) => x.id === draft.value.area);
    return a ? areaLabel(a, marketName.value) : `Anywhere in ${marketName.value}`;
  });
  const whenValue = computed(() => {
    const { from, kind, category } = draft.value;
    // One day chosen, no second yet: that day.
    const to = draft.value.to ?? from;
    // Dates don't filter Services, so with a Service category they don't apply.
    if (kind === "service" && category) return "Dates: Experiences only";
    if (!from || !to) return "Any dates";
    return from === to ? formatCalendarDay(from) : `${formatCalendarDay(from)} – ${formatCalendarDay(to)}`;
  });
  // The bar's segment is narrow: "Oct 17 – 18", "Oct 31 – Nov 1", "Oct 17".
  const whenShort = computed(() => {
    const { from, kind, category } = draft.value;
    const to = draft.value.to ?? from;
    if (kind === "service" && category) return "Experiences only";
    if (!from || !to) return "Any dates";
    const [fm, fd] = [monthShort(from), Number(from.slice(8))];
    const [tm, td] = [monthShort(to), Number(to.slice(8))];
    if (from === to) return `${fm} ${fd}`;
    return fm === tm ? `${fm} ${fd} – ${td}` : `${fm} ${fd} – ${tm} ${td}`;
  });
  const whatValue = computed(() => info.value?.categories.find((c) => c.kind === draft.value.kind && c.slug === draft.value.category)?.name ?? "Anything");

  // A request to open one segment (the results page's empty state): the bar
  // on tablets and wider, the full-screen panel on phones, picks it up.
  const request = useState<{ segment: string; at: number } | null>("search-request", () => null);
  const openSearch = (segment: "where" | "when" | "what") => (request.value = { segment, at: Date.now() });

  return { draft, info, marketSlug, marketName, whereValue, whenValue, whenShort, whatValue, request, openSearch };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A calendar date's month, short ("2026-10-17" is "Oct"): the day itself, in no zone. */
const monthShort = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!;
