import type { Database } from "@repo/types";

// GET /api/public/fees: lokl's commission per kind of listing, as the Fees
// page shows it ("12%"), read live with the signed-out client (public since
// migration commission_rates_public, 2026-10-17).
export default defineEventHandler(async (event) => {
  // bounded: one row per kind of listing (two)
  const { data, error } = await usePublicDb(event).from("commission_rates").select("kind, rate_bps");
  if (error) throw publicFailure(error);
  const rows = (data ?? []) as Pick<Database["public"]["Tables"]["commission_rates"]["Row"], "kind" | "rate_bps">[];
  const percent = (kind: string) => {
    const bps = rows.find((r) => r.kind === kind)?.rate_bps;
    return bps === undefined ? null : `${Number((bps / 100).toFixed(2))}%`;
  };
  const service = percent("service");
  const experience = percent("experience");
  if (!service || !experience) throw publicFailure("commission_rates is missing a kind");
  return { service, experience };
});
