<script setup lang="ts">
import { ADMIN_ROLE_LABEL, type AdminRole } from "@repo/types";

// Joining the team (docs/design/admin-roles.md, Joining): for an invited
// member who has set up an authenticator and passed the second step (the
// middleware sends them here, and lets no one else in). admin_join() turns
// the invitation into membership, within 7 days of it; the owners are told.
useHead({ title: "Join the team · Admin" });

const supabase = useSupabaseClient();
const role = ref<AdminRole | null>(null);
const invitedAt = ref<string | null>(null);
const error = ref("");
const busy = ref(false);

onMounted(async () => {
  // bounded: their own row, at most one
  const { data } = await supabase.from("admin_members").select("role, invited_at").eq("status", "invited").maybeSingle();
  role.value = (data?.role as AdminRole | undefined) ?? null;
  invitedAt.value = data?.invited_at ?? null;
});

async function join() {
  error.value = "";
  busy.value = true;
  const { error: e } = await supabase.rpc("admin_join");
  busy.value = false;
  if (e) {
    error.value = e.message || "That didn't work. Try again.";
    return;
  }
  // A full load: the menu and pages read the new role from the start.
  window.location.assign("/");
}
</script>

<template>
  <div class="mx-auto max-w-xl">
    <PageHeader title="Join the lokl admin team" />
    <p class="mt-2">
      You've been invited<template v-if="role"> as <strong>{{ ADMIN_ROLE_LABEL[role] }}</strong></template>.
      Your authenticator is set up, so you can join now.
    </p>
    <p v-if="invitedAt" class="text-muted-foreground mt-2 text-sm">
      Invited {{ formatHomeDate(invitedAt) }}. An invitation lasts 7 days.
    </p>
    <p v-if="error" role="alert" class="text-destructive mt-4 text-sm">{{ error }}</p>
    <UiButton class="mt-6 min-h-11" :disabled="busy" @click="join">{{ busy ? "Joining…" : "Join the team" }}</UiButton>
  </div>
</template>
