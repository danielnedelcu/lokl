// The provider pickers on the admin tables: SearchSelect searches providers
// on the server (admin_providers_page, 20 at a time, by name or owner email;
// the email is matched, never shown: admin roles step 5c),
// and the chosen provider's name is looked up from its id (in the URL) so
// the box names it after a reload.
export function useProviderPicker(selectedId: () => string | undefined) {
  const supabase = useSupabaseClient();

  async function search(term: string, signal: AbortSignal): Promise<{ value: string; label: string; description?: string }[]> {
    const { data, error } = await supabase
      .rpc("admin_providers_page", { p_q: term || undefined, p_sort: "name", p_desc: false, p_page_size: 20 })
      .abortSignal(signal);
    const page = asServerPage("admin_providers_page", data, error);
    // Two businesses can share a name: their market and joining date tell them apart.
    return page.rows.map((p) => ({
      value: p.id, label: p.display_name,
      description: [p.city ? `${p.city.name}, ${p.city.state}` : null, `joined ${formatHomeDate(p.created_at)}`].filter(Boolean).join(" · "),
    }));
  }

  const selectedLabel = ref<string | undefined>();
  watch(selectedId, async (id) => {
    selectedLabel.value = undefined;
    if (!id) return;
    const { data } = await supabase.from("providers").select("display_name").eq("id", id).maybeSingle();
    if (selectedId() === id) selectedLabel.value = data?.display_name;
  }, { immediate: true });

  return { search, selectedLabel };
}
