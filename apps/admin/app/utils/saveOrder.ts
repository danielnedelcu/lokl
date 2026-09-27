import type { SupabaseClient } from "@supabase/supabase-js";

// Moves items[index] one place up (-1) or down (+1) and saves the new
// sort_order of every row whose position changed. Rows often share
// sort_order 0 at first, so the whole list is renumbered 0, 1, 2…
export async function saveOrder(
  supabase: SupabaseClient,
  table: "categories" | "service_areas" | "cities",
  items: { id: string; sort_order: number }[],
  index: number,
  direction: -1 | 1,
) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  for (const [position, item] of next.entries()) {
    if (item.sort_order === position) continue;
    const { error } = await supabase.from(table).update({ sort_order: position }).eq("id", item.id);
    if (error) throw error;
  }
}
