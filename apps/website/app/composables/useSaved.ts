// The signed-in customer's saved listings and providers, for the hearts
// (docs/design/favourites.md, The heart). Loaded once per page visit in the
// browser (public pages are built as a signed-out visitor sees them), and
// shared by every heart on the page.
//
// - A tap flips the heart at once; the change is sent in the background.
//   Only the last state is sent: quick save-unsave-save taps end saved, with
//   one request after the one in flight.
// - If the database refuses or the request fails, the heart flips back and
//   a message says why.
// - Signed out, a tap opens the sign-in dialog (useSignIn). Sending the code
//   remembers what was being saved (a 30-minute cookie); once signed in, by
//   code on the page or by the emailed link back to it, it's saved once.

export type SavedKind = "listing" | "provider";
const key = (kind: SavedKind, id: string) => `${kind}:${id}`;
const INTENT_COOKIE = "lokl_save_intent";
const INTENT_MS = 30 * 60_000;
// One load per page visit, however many hearts ask (browser only).
let loading: Promise<void> | null = null;

interface SaveIntent {
  kind: SavedKind;
  id: string;
  name: string;
  path: string;
  at: number;
}

export function useSaved() {
  const supabase = useSupabaseClient();
  const user = useSupabaseUser();
  // What the database has, and what the person last asked for.
  const saved = useState<Record<string, boolean>>("saved-items", () => ({}));
  const wanted = useState<Record<string, boolean>>("saved-wanted", () => ({}));
  const loaded = useState("saved-loaded", () => false);
  const ownProviderId = useState<string | null>("saved-own-provider", () => null);
  const announcement = useState("saved-announcement", () => "");
  const inFlight = new Set<string>();

  function load() {
    if (!import.meta.client || !user.value || loaded.value) return Promise.resolve();
    loading ??= loadNow().finally(() => (loading = null));
    return loading;
  }
  async function loadNow() {
    if (!user.value) return;
    const [listings, providers, own] = await Promise.all([
      supabase.from("saved_listings").select("listing_id").limit(500),
      supabase.from("saved_providers").select("provider_id").limit(500),
      supabase.from("providers").select("id").eq("owner_id", user.value.sub).maybeSingle(),
    ]);
    const next: Record<string, boolean> = {};
    for (const r of listings.data ?? []) next[key("listing", r.listing_id)] = true;
    for (const r of providers.data ?? []) next[key("provider", r.provider_id)] = true;
    saved.value = next;
    wanted.value = { ...next };
    ownProviderId.value = own.data?.id ?? null;
    loaded.value = !listings.error && !providers.error;
    await applyIntent();
  }

  const isSaved = (kind: SavedKind, id: string) => !!wanted.value[key(kind, id)];

  /** Sends what the person wants, until the database matches; returns the error, if any. */
  async function sync(kind: SavedKind, id: string): Promise<{ message: string; code?: string } | null> {
    const k = key(kind, id);
    if (inFlight.has(k)) return null;
    inFlight.add(k);
    try {
      while (!!wanted.value[k] !== !!saved.value[k]) {
        const on = !!wanted.value[k];
        // No changed-row check (unlike other direct writes): saving
        // something already saved, or removing something already gone,
        // changes no row and leaves it as wanted. A refused save is an
        // error (42501), never a silent zero rows.
        const { error } = kind === "listing"
          ? on
            ? await supabase.from("saved_listings").upsert({ listing_id: id } as never, { onConflict: "customer_id,listing_id", ignoreDuplicates: true })
            : await supabase.from("saved_listings").delete().eq("listing_id", id)
          : on
            ? await supabase.from("saved_providers").upsert({ provider_id: id } as never, { onConflict: "customer_id,provider_id", ignoreDuplicates: true })
            : await supabase.from("saved_providers").delete().eq("provider_id", id);
        if (error) {
          wanted.value = { ...wanted.value, [k]: !!saved.value[k] };
          return error;
        }
        saved.value = { ...saved.value, [k]: on };
      }
      return null;
    } finally {
      inFlight.delete(k);
    }
  }

  /** A tap on a heart. Signed out: asks them to sign in. */
  async function toggle(kind: SavedKind, id: string, name: string) {
    if (!user.value) {
      const path = route.path;
      signIn.open({ title: `Sign in to save ${name}`, beforeSend: () => writeIntent({ kind, id, name, path, at: Date.now() }) });
      return;
    }
    if (!loaded.value) return;
    const k = key(kind, id);
    const on = !wanted.value[k];
    wanted.value = { ...wanted.value, [k]: on };
    announcement.value = on ? `Saved ${name}` : `Removed ${name} from Saved`;
    const error = await sync(kind, id);
    if (error) {
      announcement.value = "";
      useSonner.error(failureMessage(kind, name, on, error));
    }
  }

  function failureMessage(kind: SavedKind, name: string, saving: boolean, error: { message: string; code?: string }) {
    if (saving && error.code === "42501") {
      return kind === "listing" ? "This listing isn't available any more, so it can't be saved." : "This provider isn't available any more, so they can't be saved.";
    }
    if (error.code === "23514") return error.message;
    return saving ? `${name} wasn't saved. Check your connection and try again.` : `${name} wasn't removed from Saved. Check your connection and try again.`;
  }

  // ---------------------------------------------------------------------------
  // The sign-in return trip
  // ---------------------------------------------------------------------------

  const route = useRoute();
  const signIn = useSignIn();

  /** Back from signing in: save what they were saving, once, on the page they were on. */
  async function applyIntent() {
    const intent = readIntent();
    if (!intent) return;
    writeIntent(null);
    if (Date.now() - intent.at > INTENT_MS || intent.path !== route.path.split("?")[0]) return;
    const k = key(intent.kind, intent.id);
    wanted.value = { ...wanted.value, [k]: true };
    const error = await sync(intent.kind, intent.id);
    if (error) return useSonner.error(failureMessage(intent.kind, intent.name, true, error));
    announcement.value = `Saved ${intent.name}`;
    useSonner.success(`Saved ${intent.name}.`);
  }

  /** Signed out, or someone else signed in: forget the last person's saved items. */
  function reset() {
    saved.value = {};
    wanted.value = {};
    loaded.value = false;
    ownProviderId.value = null;
  }

  return { load, reset, loaded, isSaved, toggle, ownProviderId, announcement };
}

// The intent cookie, read and written directly: the code sign-in reads it
// moments after the dialog wrote it, from another useSaved() (a useCookie
// ref keeps the value it read when it was made). Browser only.
function readIntent(): SaveIntent | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${INTENT_COOKIE}=`))?.slice(INTENT_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as SaveIntent;
    return v && typeof v.id === "string" && (v.kind === "listing" || v.kind === "provider") ? v : null;
  } catch {
    return null;
  }
}
function writeIntent(intent: SaveIntent | null) {
  document.cookie = intent
    ? `${INTENT_COOKIE}=${encodeURIComponent(JSON.stringify(intent))}; Max-Age=${INTENT_MS / 1000}; Path=/; SameSite=Lax`
    : `${INTENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
