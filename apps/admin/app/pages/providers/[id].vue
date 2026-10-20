<script setup lang="ts">
import { adminActionLabel } from "@repo/types";

// One provider, for the team (admin roles step 5e): who they are, their
// hidden profile content (with the owner's decisions), and their history:
// every action lokl's team took about them, newest first, with the reason.
const route = useRoute();
const id = computed(() => String(route.params.id));
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const HISTORY_PAGE = 20;
const page = ref(1);

const { data: provider, error } = await useAsyncData(`admin-provider-${id.value}`, async () => {
  const { data, error: e } = await supabase.from("providers").select("id, display_name, slug, status, created_at").eq("id", id.value).maybeSingle();
  if (e) throw e;
  return data;
});
watch(error, (e) => e && reportProblem("Couldn't load this provider", e), { immediate: true });
useHead({ title: () => `${provider.value?.display_name ?? "Provider"} · Admin` });

const { data: history, error: historyError } = await useAsyncData(`admin-provider-history-${id.value}`, async () => {
  const from = (page.value - 1) * HISTORY_PAGE;
  const { data, error: e, count } = await supabase.from("admin_actions")
    .select("id, admin_id, action, reason, message, created_at", { count: "exact" })
    .eq("target", "provider").eq("target_id", id.value)
    .order("created_at", { ascending: false }).range(from, from + HISTORY_PAGE - 1);
  if (e) throw e;
  const ids = [...new Set((data ?? []).map((a) => a.admin_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: n } = await supabase.rpc("admin_member_names", { p_ids: ids }, { get: true });
    for (const m of n ?? []) names.set(m.user_id, m.email);
  }
  return { total: count ?? 0, rows: (data ?? []).map((a) => ({ ...a, who: a.admin_id === user.value?.sub ? "You" : (a.admin_id && names.get(a.admin_id)) || "Someone no longer on the team" })) };
}, { watch: [page] });
watch(historyError, (e) => e && reportProblem("Couldn't load this provider's history", e), { immediate: true });
const pages = computed(() => Math.max(1, Math.ceil((history.value?.total ?? 0) / HISTORY_PAGE)));
const profileOpen = ref(false);
</script>

<template>
  <div class="max-w-3xl">
    <UiButton variant="link" class="mb-2 px-0" to="/providers">← Providers</UiButton>
    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load this provider</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <EmptyState v-else-if="!provider" icon="lucide:store" title="We couldn't find that provider" description="It may have been a mistyped address." />
    <template v-else>
      <PageHeader :title="provider.display_name" :description="`Joined ${formatHomeDate(provider.created_at)}.`" />
      <div class="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge kind="provider" :status="provider.status" />
        <UiButton size="sm" variant="outline" @click="profileOpen = true">Profile</UiButton>
      </div>

      <ProfileHoldsQueue :provider-id="provider.id" />

      <section class="mt-10" aria-labelledby="history-heading">
        <h2 id="history-heading" class="text-lg font-semibold">History</h2>
        <UiAlert v-if="historyError" variant="destructive" class="mt-3">
          <UiAlertTitle>Couldn't load the history</UiAlertTitle>
          <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
        </UiAlert>
        <p v-else-if="!history?.rows.length" class="text-muted-foreground mt-3 text-sm">Nothing yet.</p>
        <ul v-else class="divide-border bg-card border-border mt-3 divide-y rounded-lg border text-sm">
          <li v-for="a in history.rows" :key="a.id" class="p-4">
            <p><span class="font-medium">{{ a.who }}</span> {{ adminActionLabel(a.action) }}</p>
            <p v-if="a.reason" class="text-muted-foreground mt-1">Reason: “{{ a.reason }}”</p>
            <p v-if="a.message" class="text-muted-foreground mt-1">Message to them: “{{ a.message }}”</p>
            <p class="text-muted-foreground mt-1 text-xs">{{ formatHomeDateTime(a.created_at) }} (Atlanta time)</p>
          </li>
        </ul>
        <div v-if="pages > 1" class="mt-3 flex items-center gap-2 text-sm">
          <UiButton size="sm" variant="outline" :disabled="page <= 1" @click="page--">Previous</UiButton>
          <span>Page {{ page }} of {{ pages }}</span>
          <UiButton size="sm" variant="outline" :disabled="page >= pages" @click="page++">Next</UiButton>
        </div>
      </section>
      <ProviderProfileSheet v-model:open="profileOpen" :provider-id="provider.id" />
    </template>
  </div>
</template>
