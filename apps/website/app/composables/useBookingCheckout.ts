// Sends a booking form to its route and goes to Stripe Checkout. Errors come
// back as the route's own sentences ("There aren't enough spots left...").
//
// One key per checkout attempt, sent with the request: if the reply is lost
// after the server made the booking, pressing again sends the same key, and
// the server returns that booking and its Checkout instead of a second one.
// A new key when the details change (newAttempt, called by the form) or when
// the server answered with a refusal (that attempt is over).
import type { AnalyticsEvent } from "@repo/types";

export type CheckoutResult = "sent" | "refused" | "lost";

export function useBookingCheckout() {
  const sending = ref(false);
  const problem = ref("");
  let checkoutKey = globalThis.crypto.randomUUID();
  const newAttempt = () => {
    checkoutKey = globalThis.crypto.randomUUID();
  };

  const { send } = useAnalytics();
  // `begun`: the begin_checkout event (analytics.ts), sent once the booking is made, before Stripe.
  async function start(path: "/api/bookings/service" | "/api/bookings/experience", body: Record<string, unknown>, begun?: AnalyticsEvent): Promise<CheckoutResult> {
    sending.value = true;
    problem.value = "";
    try {
      const { url } = await $fetch<{ url: string }>(path, { method: "POST", body: { ...body, checkoutKey } });
      if (begun) send(begun);
      window.location.href = url;
      return "sent";
    } catch (e) {
      const err = e as { statusCode?: number; data?: { statusMessage?: string } };
      problem.value = err.statusCode === 400
        ? "Some details aren't right. Check the form and try again."
        : err.data?.statusMessage ?? "Checkout couldn't be started. Please try again.";
      sending.value = false;
      // No reply, or a server failure: the booking may exist, so a retry
      // keeps the key. A refusal (4xx) ended this attempt.
      const refused = typeof err.statusCode === "number" && err.statusCode < 500;
      if (refused) newAttempt();
      return refused ? "refused" : "lost";
    }
  }
  return { sending, problem, start, newAttempt };
}

// The name from the customer's last booking, to save retyping it.
export async function lastBookingName(): Promise<string> {
  try {
    const { items } = await $fetch<{ items: { customer_name: string }[] }>("/api/account/bookings", { query: { group: "latest" } });
    return items[0]?.customer_name ?? "";
  } catch {
    return "";
  }
}
