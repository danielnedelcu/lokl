// Sends a booking form to its route and goes to Stripe Checkout. Errors come
// back as the route's own sentences ("There aren't enough spots left...").
export function useBookingCheckout() {
  const sending = ref(false);
  const problem = ref("");

  async function start(path: "/api/bookings/service" | "/api/bookings/experience", body: unknown) {
    sending.value = true;
    problem.value = "";
    try {
      const { url } = await $fetch<{ url: string }>(path, { method: "POST", body });
      window.location.href = url;
      return true;
    } catch (e) {
      const err = e as { statusCode?: number; data?: { statusMessage?: string } };
      problem.value = err.statusCode === 400
        ? "Some details aren't right. Check the form and try again."
        : err.data?.statusMessage ?? "Checkout couldn't be started. Please try again.";
      sending.value = false;
      return false;
    }
  }
  return { sending, problem, start };
}

// The name from the customer's last booking, to save retyping it.
export async function lastBookingName(): Promise<string> {
  try {
    const list = await $fetch<{ customer_name: string }[]>("/api/account/bookings");
    return list[0]?.customer_name ?? "";
  } catch {
    return "";
  }
}
