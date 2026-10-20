<script setup lang="ts">
import { PROFILE_PART_LABELS, PROFILE_RULES, rpcJson, type AdminProfileHoldRow, type ProfileRule } from "@repo/types";

// Hidden profile content (admin roles step 5e), on the Requests page. The
// owner decides each: confirm the removal (the hidden version is deleted),
// restore it (only while the provider hasn't replaced it), or, once they
// have, dismiss it (it didn't break the rule). One waiting over 7 days is
// first and stays hidden: nothing is ever deleted without the owner.
// Support sees the ones they hid, and can't decide them. A photo's files
// still at their public address say so, with "Try again".
const props = defineProps<{ providerId?: string }>();
const supabase = useSupabaseClient();
const call = useWebsiteAdmin();
const role = useAdminRole();
const isOwner = computed(() => role.value === "owner");
const scope = ref<"open" | "decided">("open");
const page = ref(1);
const PAGE_SIZE = 25;

const { data, error, refresh } = await useAsyncData(`profile-holds-${props.providerId ?? "all"}`, async () => {
  // On a provider's page: every one of theirs, waiting first.
  const { data: d, error: e } = await supabase.rpc("admin_profile_holds_page", {
    p_scope: props.providerId ? "all" : scope.value, p_page: page.value, p_page_size: PAGE_SIZE, p_provider_id: props.providerId,
  }, { get: true });
  if (e) throw e;
  return rpcJson("admin_profile_holds_page", d);
}, { watch: [scope, page] });
watch(error, (e) => e && reportProblem("Couldn't load the hidden profile content", e), { immediate: true });
watch(scope, () => (page.value = 1));
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / PAGE_SIZE)));

// A hidden photo, by a short-lived link while it's private; at its public
// address while its move hasn't happened yet.
const photos = ref(new Map<string, string>());
watch(data, async (d) => {
  const next = new Map<string, string>();
  for (const r of d?.rows ?? []) {
    if (r.part !== "avatar" && r.part !== "cover") continue;
    if (r.files === "private" || r.files === "deleting") {
      const { data: signed } = await supabase.storage.from("provider-photos-held").createSignedUrl(r.held_paths![0]!, 300);
      if (signed?.signedUrl) next.set(r.id, signed.signedUrl);
    } else if (r.files === "moving" || r.files === "public" || r.files === "restoring") {
      next.set(r.id, supabase.storage.from("provider-photos").getPublicUrl(r.public_paths![0]!).data.publicUrl);
    }
  }
  photos.value = next;
}, { immediate: true });

const busy = ref(false);
const deciding = ref<{ row: AdminProfileHoldRow; decision: "remove" | "restore" | "dismiss" } | null>(null);
const dialogOpen = ref(false);
const problem = ref("");
const copy = computed(() => {
  const d = deciding.value;
  if (!d) return { title: "", description: "", confirm: "", destructive: false };
  const what = PROFILE_PART_LABELS[d.row.part].admin.toLowerCase();
  if (d.decision === "remove") {
    return { title: `Confirm removing ${d.row.provider.name}'s ${what}?`, confirm: "Confirm removal", destructive: true,
      description: "It broke the rule. The hidden version is deleted for good, and they're emailed that it's removed, with the rule." };
  }
  if (d.decision === "restore") {
    return { title: `Restore ${d.row.provider.name}'s ${what}?`, confirm: "Restore", destructive: false,
      description: "It didn't break the rule. It goes back on their profile, and they're emailed that it's back." };
  }
  return { title: `Dismiss: ${d.row.provider.name}'s ${what} didn't break the rule?`, confirm: "Dismiss", destructive: false,
    description: "Only if the hidden version truly didn't break the rule. They've already replaced it, so nothing changes on their profile; the hidden version is deleted and they're told it was fine. If it did break the rule, confirm the removal instead." };
});
function ask(row: AdminProfileHoldRow, decision: "remove" | "restore" | "dismiss") {
  deciding.value = { row, decision };
  problem.value = "";
  dialogOpen.value = true;
}
async function decide(note: string) {
  const d = deciding.value;
  if (!d) return;
  busy.value = true;
  problem.value = "";
  try {
    await call(`providers/holds/${d.row.id}/decide`, { decision: d.decision, note: note || undefined });
    useSonner.success(d.decision === "remove" ? "Removed. They've been emailed." : d.decision === "restore" ? "Restored. They've been emailed." : "Dismissed. They've been told it was fine.");
    dialogOpen.value = false;
  } catch (e) {
    problem.value = (e as Error).message;
  } finally {
    busy.value = false;
    await refresh();
  }
}
async function retryFiles() {
  busy.value = true;
  try {
    const { result } = await call<{ result: string }>("providers/holds/retry-files");
    if (result === "settled") useSonner.success("Done: the photos' files are where they should be.");
    else useSonner.error("Some files still didn't move. Try again in a minute, or check the server logs.");
  } catch (e) {
    useSonner.error((e as Error).message);
  } finally {
    busy.value = false;
    await refresh();
  }
}
const unsettled = (r: AdminProfileHoldRow) => ["moving", "restoring", "deleting"].includes(r.files);
const filesNote = (r: AdminProfileHoldRow) =>
  r.files === "moving" ? "Off the profile, but the photo is still at its public address."
  : r.files === "restoring" ? "Restored, but the photo hasn't moved back yet."
  : r.files === "deleting" ? "Decided, but the photo's files aren't deleted yet."
  : r.files === "missing" ? "The photo's files were already gone when it was hidden." : "";
const STATUS_WORDS = { hidden: "Waiting", removed: "Removed", restored: "Restored", dismissed: "Dismissed" } as const;
</script>

<template>
  <section aria-labelledby="holds-heading" :class="props.providerId ? '' : 'mt-10'">
    <h2 id="holds-heading" class="text-lg font-semibold">Hidden profile content</h2>
    <p v-if="!props.providerId" class="text-muted-foreground mt-1 text-sm">
      {{ isOwner ? "Off the profile and kept until you decide. Waiting over 7 days comes first; nothing is deleted without you." : "What you've hidden. The owner decides each." }}
    </p>
    <div v-if="!props.providerId" class="mt-3 flex gap-2" role="group" aria-label="Which hidden content">
      <UiButton size="sm" :variant="scope === 'open' ? 'default' : 'outline'" :aria-pressed="scope === 'open'" @click="scope = 'open'">To decide</UiButton>
      <UiButton size="sm" :variant="scope === 'decided' ? 'default' : 'outline'" :aria-pressed="scope === 'decided'" @click="scope = 'decided'">Done</UiButton>
    </div>

    <UiAlert v-if="error" variant="destructive" class="mt-3">
      <UiAlertTitle>Couldn't load the hidden profile content</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <p v-else-if="!data?.rows.length" class="text-muted-foreground mt-3 text-sm">
      {{ props.providerId ? "Nothing of theirs has been hidden." : scope === "open" ? "Nothing waiting." : "Nothing decided yet." }}
    </p>
    <ul v-else class="mt-3 space-y-3">
      <li v-for="r in data.rows" :key="r.id" class="bg-card border-border rounded-lg border p-4 text-sm"
        :aria-label="`${r.provider.name}: ${PROFILE_PART_LABELS[r.part].admin}`">
        <p class="font-medium">
          <NuxtLink :to="`/providers/${r.provider.id}`" class="link-text">{{ r.provider.name }}</NuxtLink>: {{ PROFILE_PART_LABELS[r.part].admin }}
          <span class="text-muted-foreground font-normal"> · {{ STATUS_WORDS[r.status] }}</span>
          <span v-if="r.overdue" class="text-destructive ml-2 font-normal"><Icon name="lucide:clock-alert" class="mr-1 inline size-4" aria-hidden="true" />Waiting over 7 days</span>
        </p>
        <div class="mt-2">
          <img v-if="photos.get(r.id)" :src="photos.get(r.id)" :alt="`The hidden ${PROFILE_PART_LABELS[r.part].admin.toLowerCase()}`"
            :class="r.part === 'avatar' ? 'size-20 rounded-full object-cover' : 'aspect-[3/1] w-full max-w-md rounded-md object-cover'">
          <p v-else-if="r.held_text" class="bg-muted rounded-md p-2 whitespace-pre-line">“{{ r.held_text }}”</p>
          <p v-else-if="r.status === 'removed' || r.status === 'dismissed'" class="text-muted-foreground">The hidden version has been deleted.</p>
        </div>
        <p class="mt-2">Rule: {{ PROFILE_RULES[r.rule as ProfileRule] ?? r.rule }}</p>
        <p class="text-muted-foreground mt-1">Reason: “{{ r.reason }}”<template v-if="r.message"> · Message to them: “{{ r.message }}”</template></p>
        <p class="text-muted-foreground mt-1">
          Hidden by {{ r.hidden_by_email ?? "someone no longer on the team" }}, {{ formatHomeDateTime(r.hidden_at) }} (Atlanta time)<template v-if="r.decided_at">.
          {{ STATUS_WORDS[r.status] }} by {{ r.decided_by_email ?? "someone no longer on the team" }}, {{ formatHomeDateTime(r.decided_at) }} (Atlanta time)</template>.
        </p>
        <p v-if="r.status === 'hidden' && r.slot_filled" class="mt-1">They've added a new one since, so it can't be restored over it.</p>
        <p v-if="filesNote(r)" class="mt-2" :class="unsettled(r) ? 'text-destructive' : 'text-muted-foreground'" role="status">
          <Icon v-if="unsettled(r)" name="lucide:triangle-alert" class="mr-1 inline size-4" aria-hidden="true" />{{ filesNote(r) }}
          <UiButton v-if="unsettled(r)" size="sm" variant="outline" class="ml-2" :disabled="busy" @click="retryFiles">Try again</UiButton>
        </p>
        <div v-if="isOwner && r.status === 'hidden'" class="mt-3 flex flex-wrap gap-2">
          <UiButton size="sm" variant="destructive" :disabled="busy" @click="ask(r, 'remove')">Confirm removal</UiButton>
          <UiButton v-if="!r.slot_filled" size="sm" variant="outline" :disabled="busy || r.files === 'missing'" @click="ask(r, 'restore')">Restore</UiButton>
          <UiButton v-else size="sm" variant="outline" :disabled="busy" @click="ask(r, 'dismiss')">Dismiss: it didn't break the rule</UiButton>
        </div>
      </li>
    </ul>
    <div v-if="pages > 1" class="mt-3 flex items-center gap-2 text-sm">
      <UiButton size="sm" variant="outline" :disabled="page <= 1" @click="page--">Previous</UiButton>
      <span>Page {{ page }} of {{ pages }}</span>
      <UiButton size="sm" variant="outline" :disabled="page >= pages" @click="page++">Next</UiButton>
    </div>

    <ReasonDialog v-model:open="dialogOpen" :title="copy.title" :description="copy.description" :confirm-label="copy.confirm"
      :destructive="copy.destructive" :busy="busy" :error="problem" reason-label="Note (lokl only, optional)" :reason-optional="true"
      hint="Kept in the provider's history. Never shown to them." @confirm="decide" />
  </section>
</template>
