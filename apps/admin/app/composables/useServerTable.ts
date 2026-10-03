// One pattern for the admin's server-side tables (Bookings, Experiences,
// Services, Providers; planned 2026-10-03). The search text, filters, page
// and sort live in the URL, so back, reload and bookmarks work; the page asks
// the database for one page of rows plus the total.
//
// - Values in the URL are checked; anything that doesn't make sense is
//   ignored, not trusted.
// - Changing a filter, the sort or the page adds a history entry; typing in
//   the search box replaces the current one (Back doesn't replay keystrokes).
//   Anything but the page itself goes back to page 1.
// - Each request carries an AbortSignal: a newer request cancels the older
//   one, and a late answer never overwrites a newer one.

export interface ServerPage<Row> {
  rows: Row[];
  total: number;
  /** False once a table switches to an estimated total ("About 12,400"). */
  total_exact: boolean;
}

export interface ServerTableQuery<F extends string> {
  q: string;
  filters: Partial<Record<F, string>>;
  page: number;
  sort: string;
  desc: boolean;
}

export interface ServerTableOptions<F extends string, Row> {
  /** The filters this table has, each with its check (return the value if it's acceptable). */
  filters: Record<F, (value: string) => boolean>;
  /** Server sort keys this table accepts; the first is the default. */
  sorts: readonly string[];
  defaultDesc?: boolean;
  load: (query: ServerTableQuery<F>, signal: AbortSignal) => Promise<ServerPage<Row>>;
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const oneOf = (...values: string[]) => (v: string) => values.includes(v);

export function useServerTable<F extends string, Row>(opts: ServerTableOptions<F, Row>) {
  const route = useRoute();
  const router = useRouter();
  const one = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "");

  // The URL, checked.
  const query = computed<ServerTableQuery<F>>(() => {
    const q = route.query;
    const filters: Partial<Record<F, string>> = {};
    for (const [name, ok] of Object.entries(opts.filters) as [F, (v: string) => boolean][]) {
      const value = one(q[name]).trim();
      if (value && ok(value)) filters[name] = value;
    }
    const page = Number.parseInt(one(q.page), 10);
    const sort = one(q.sort);
    return {
      q: one(q.q).slice(0, 200),
      filters,
      page: Number.isInteger(page) && page > 0 ? page : 1,
      sort: opts.sorts.includes(sort) ? sort : opts.sorts[0]!,
      desc: one(q.dir) === "asc" ? false : one(q.dir) === "desc" ? true : (opts.defaultDesc ?? true),
    };
  });

  function go(changes: Record<string, string | number | null | undefined>, history: "push" | "replace" = "push") {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...route.query, ...changes })) {
      const value = one(v as unknown) || (typeof v === "number" ? String(v) : "");
      if (value) next[k] = value;
    }
    // Page 1 is the default: keep the address short.
    if (next.page === "1") delete next.page;
    return history === "push" ? router.push({ query: next }) : router.replace({ query: next });
  }

  const setFilter = (name: F, value: string | null | undefined) => go({ [name]: value ?? null, page: null });
  const setFilters = (values: Partial<Record<F, string | null>>) => go({ ...values, page: null });
  const setSearch = (q: string) => go({ q: q.trim() || null, page: null }, "replace");
  const setPage = (page: number) => go({ page });
  const setSort = (sort: string, desc: boolean) => go({ sort, dir: desc ? "desc" : "asc", page: null });
  const clear = () => router.push({ query: {} });

  // Loading: the newest request wins.
  const rows = shallowRef<Row[]>([]);
  const total = ref(0);
  const totalExact = ref(true);
  const pending = ref(true);
  const error = ref<unknown>(null);
  let controller: AbortController | null = null;

  async function load() {
    controller?.abort();
    const mine = (controller = new AbortController());
    pending.value = true;
    try {
      const page = await opts.load(query.value, mine.signal);
      if (mine.signal.aborted) return;
      rows.value = page.rows;
      total.value = page.total;
      totalExact.value = page.total_exact;
      error.value = null;
    } catch (e) {
      if (mine.signal.aborted) return;
      error.value = e;
      reportProblem("Couldn't load the table", e);
    } finally {
      if (!mine.signal.aborted) pending.value = false;
    }
  }
  watch(() => JSON.stringify(query.value), () => void load(), { immediate: true });
  onBeforeUnmount(() => controller?.abort());

  const filtering = computed(() => !!(query.value.q || Object.keys(query.value.filters).length));

  return { query, rows, total, totalExact, pending, error, setFilter, setFilters, setSearch, setPage, setSort, clear, refresh: load, filtering };
}

/** A database page function's answer as a ServerPage, or throw its error. */
export function asServerPage<Row>(data: unknown, error: { message: string } | null): ServerPage<Row> {
  if (error) throw error;
  const page = data as Partial<ServerPage<Row>> | null;
  return { rows: page?.rows ?? [], total: page?.total ?? 0, total_exact: page?.total_exact ?? true };
}
