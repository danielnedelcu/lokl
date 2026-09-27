// The one place money is formatted for display (docs/frontend.md).
// Amounts are stored in cents: formatMoney(4500) -> "$45.00".
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
