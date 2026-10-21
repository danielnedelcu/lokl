// Live notifications: a provider's bell, and an admin's (problem reports;
// docs/design/notifications.md, Realtime; docs/design/problem-reports.md).
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
import type { NotificationKind } from "@repo/types";

// A row as Realtime sends it: ids only, never text. A reply to a problem
// report has no listing.
export interface NotificationRow {
  id: string;
  provider_id: string;
  kind: NotificationKind;
  listing_id: string | null;
  booking_id: string | null;
  support_report_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** An admin bell's row (admin_notifications): ids only, never text. */
export interface AdminNotificationRow {
  id: string;
  recipient_id: string;
  kind: "support_new" | "support_safety" | "support_reply" | "team_change" | "request_new" | "request_decided" | "limit_reached" | "support_refund" | "listing_taken_down" | "settings_change" | "profile_hidden"
  | "profile_hidden_overdue" | "job_alert";
  /** A problem report's (null for a team change). */
  report_id: string | null;
  /** A team change's admin_actions row (null otherwise). */
  admin_action_id: string | null;
  /** A job alert's job_alerts row (null otherwise). */
  job_alert_id?: string | null;
  /** A support request's row: new (owners) or decided (the asker); null otherwise. */
  admin_request_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationFeedHandlers<Row = NotificationRow> {
  onReady?: () => void;
  onNotification: (row: Row) => void;
  onProblem?: (message: string) => void;
  /** Status lines for the console (joining, ready, reconnecting). */
  onStatus?: (message: string) => void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Which rows to watch: the provider's bell (`notifications` by provider_id,
 * the default), or an admin's (`admin_notifications` by recipient_id).
 */
export interface NotificationSource {
  table: "notifications" | "admin_notifications";
  column: "provider_id" | "recipient_id";
}

export function createNotificationFeed<Row = NotificationRow>(
  supabase: SupabaseClient, ownerId: string, handlers: NotificationFeedHandlers<Row>,
  source: NotificationSource = { table: "notifications", column: "provider_id" },
) {
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
      .channel(`${source.table}:${ownerId}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: source.table, filter: `${source.column}=eq.${ownerId}` },
        (payload) => handlers.onNotification(payload.new as Row),
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
