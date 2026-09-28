// A provider's live notifications (docs/design/notifications.md, Realtime).
// Framework-free, so the bell and the Realtime tests use the same code.
//
// - Ready means Realtime is watching the database ("Subscribed to
//   PostgreSQL"), not just that the channel joined: a change made between the
//   two is lost. onReady fires then, and after every reconnect, so the caller
//   refetches whatever it may have missed (Realtime doesn't replay).
// - Sign-in tokens: every join first loads the signed-in token into Realtime
//   (realtime.setAuth() with no argument asks supabase-js for it). On a fresh
//   page load the browser client reads its session from cookies a moment
//   after it's created; a join sent before that goes out signed out, which
//   Realtime refuses ("invalid column for filter provider_id"), and a rejoin
//   didn't always recover (reproduced on the local stack, 2026-09-28).
//   Refreshed tokens after that are passed on by supabase-js itself; the
//   token-refresh test checks it.
// - A channel that errors, times out or closes is rejoined with a backoff;
//   so is one found not joined when the tab becomes visible again (browsers
//   slow timers in hidden tabs, so the heartbeat can lapse).
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export interface NotificationRow {
  id: string;
  provider_id: string;
  kind: "listing_approved" | "listing_rejected" | "listing_unpublished" | "listing_restored";
  listing_id: string;
  created_at: string;
  read_at: string | null;
}

export interface NotificationFeedHandlers {
  onReady?: () => void;
  onNotification: (row: NotificationRow) => void;
  onProblem?: (message: string) => void;
  /** Status lines for the console (joining, ready, reconnecting). */
  onStatus?: (message: string) => void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

export function createNotificationFeed(supabase: SupabaseClient, providerId: string, handlers: NotificationFeedHandlers) {
  let channel: RealtimeChannel | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function join() {
    if (stopped) return;
    try {
      await supabase.realtime.setAuth();
    } catch (e) {
      handlers.onProblem?.(`Couldn't load the sign-in token for live updates: ${(e as Error).message}`);
    }
    if (stopped) return;
    const ch = supabase
      .channel(`notifications:${providerId}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `provider_id=eq.${providerId}` },
        (payload) => handlers.onNotification(payload.new as NotificationRow),
      )
      .on("system", {}, (m: { extension?: string; status?: string; message?: string }) => {
        if (m.extension !== "postgres_changes") return;
        if (m.status === "ok") {
          attempt = 0;
          handlers.onStatus?.("live updates on");
          handlers.onReady?.();
        } else {
          handlers.onProblem?.(m.message ?? "Realtime couldn't watch notifications.");
          rejoin();
        }
      });
    ch.subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || (status === "CLOSED" && !stopped && ch === channel)) {
        handlers.onStatus?.(`channel ${status.toLowerCase()}${err ? `: ${err.message}` : ""}; reconnecting`);
        rejoin();
      }
    });
    channel = ch;
  }

  function rejoin() {
    if (stopped || retryTimer) return;
    const old = channel;
    channel = null;
    if (old) void supabase.removeChannel(old);
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    attempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void join();
    }, delay);
  }

  const onVisible = () => {
    if (document.visibilityState === "visible" && channel && channel.state !== "joined" && channel.state !== "joining") {
      rejoin();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  void join();

  return {
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    },
    /** For tests: whether the channel is currently joined. */
    get joined() {
      return channel?.state === "joined";
    },
  };
}
