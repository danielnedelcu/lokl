import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcJson, type Database } from "@repo/types";

// AI drafting since a time (the cost log, guide_ai_drafts): how many drafts
// and what they cost, in cents, counted and added up by the database
// (admin_ai_draft_cost; adding up rows here stopped at the API's 1,000).
// Plain TypeScript, so supabase/tests/app/admin-ai-cost.test.mts runs this
// same code.
export async function aiDraftCostSince(supabase: SupabaseClient<Database>, since: string) {
  const { data, error } = await supabase.rpc("admin_ai_draft_cost", { p_since: since });
  if (error) throw error;
  const r = rpcJson("admin_ai_draft_cost", data);
  return { count: r.count, cents: Math.round(Number(r.cost_usd) * 100) };
}
