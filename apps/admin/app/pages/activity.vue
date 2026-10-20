<script setup lang="ts">
import { adminActionLabel, adminActionLink, rpcJson, type AdminActivityRow } from "@repo/types";

// Activity (admin roles step 5d): every logged action, newest first. The
// owner sees everyone's, or one person's; support sees only their own (the
// database decides: admin_activity_page()). Reasons are shown; contact
// details never are (the log holds ids).
useHead({ title: "Activity · Admin" });
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const role = useAdminRole();
const isOwner = computed(() => role.value === "owner");
const PAGE_SIZE = 50;

const page = ref(1);
const who = ref("");
const { data: members } = await useAsyncData("activity-members", async () => {
  if (!isOwner.value) return [];
  const { data, error } = await supabase.rpc("admin_team", {}, { get: true });
  if (error) throw error;
  // Removed members stay: their past actions are still in the log.
  return (data ?? []).filter((m) => m.status !== "invited");
}, { watch: [isOwner] });

const { data, error, pending } = await useAsyncData("admin-activity", async () => {
  const { data: d, error: e } = await supabase.rpc("admin_activity_page", {
    p_admin_id: isOwner.value && who.value ? who.value : undefined, p_page: page.value, p_page_size: PAGE_SIZE,
  }, { get: true });
  if (e) throw e;
  return rpcJson("admin_activity_page", d);
}, { watch: [page, who] });
watch(error, (e) => e && reportProblem("Couldn't load the activity", e), { immediate: true });
watch(who, () => (page.value = 1));
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE_SIZE)));

function whoDid(r: AdminActivityRow) {
  if (r.admin_id && r.admin_id === user.value?.sub) return "You";
  return r.admin_email ?? "Someone no longer on the team";
}
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader title="Activity"
      :description="isOwner ? 'Everything the team has done, newest first.' : 'Everything you have done, newest first.'" />

    <div v-if="isOwner" class="mb-4 max-w-xs">
      <label for="activity-who" class="text-sm font-medium">Who</label>
      <select id="activity-who" v-model="who" class="border-input bg-background mt-1 block min-h-11 w-full rounded-md border px-3 text-sm">
        <option value="">Everyone</option>
        <option v-for="m in members ?? []" :key="m.user_id" :value="m.user_id">{{ m.email }}</option>
      </select>
    </div>

    <UiAlert v-if="error" variant="destructive">
      <UiAlertTitle>Couldn't load the activity</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending && !data" class="text-muted-foreground text-sm">Loading…</p>
    <EmptyState v-else-if="!data?.rows.length" icon="lucide:history" title="Nothing yet"
      :description="isOwner ? 'Actions by anyone on the team show here.' : 'Your actions show here.'" />
    <ul v-else class="divide-border bg-card border-border divide-y rounded-lg border text-sm">
      <li v-for="r in data.rows" :key="r.id" class="p-4">
        <p>
          <span class="font-medium">{{ whoDid(r) }}</span> {{ adminActionLabel(r.action) }}<template v-if="r.message">: {{ r.message }}</template>
          <NuxtLink v-if="adminActionLink(r.target, r.target_id)" :to="adminActionLink(r.target, r.target_id)!" class="link-text ml-1">Open</NuxtLink>
        </p>
        <p v-if="r.reason" class="text-muted-foreground mt-1">Reason: “{{ r.reason }}”</p>
        <p class="text-muted-foreground mt-1 text-xs">{{ formatHomeDateTime(r.created_at) }} (Atlanta time)</p>
      </li>
    </ul>

    <div v-if="pages > 1" class="mt-3 flex items-center gap-2 text-sm">
      <UiButton size="sm" variant="outline" :disabled="page <= 1" @click="page--">Previous</UiButton>
      <span>Page {{ page }} of {{ pages }}</span>
      <UiButton size="sm" variant="outline" :disabled="page >= pages" @click="page++">Next</UiButton>
    </div>
  </div>
</template>
