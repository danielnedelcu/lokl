<script setup lang="ts">
import { ADMIN_ROLE_LABEL, adminInviteSchema, rpcJson, type AdminContactViewRow, type AdminInviteInput, type AdminRole } from "@repo/types";

// The Team page (docs/design/admin-roles.md, The Team page; step 5a): the
// owner's alone. Who's on the team, invited or removed, with their second
// factor and last sign-in; invite someone; change a role, reset someone's
// authenticators, remove someone. Every change takes a reason, is logged,
// and is emailed to every owner. The database decides: support is
// refused the functions as well as the page, and nobody changes their own
// role or removes themselves.
// - Invitations go through the website (useWebsiteAdmin), which makes the
//   login if there isn't one and sends the email; the rest are the owner's
//   own session calling the database (admin_change_role, admin_remove,
//   admin_reset_second_factor).

definePageMeta({ ownerOnly: true });
useHead({ title: "Team · Admin" });

const supabase = useSupabaseClient();
const user = useSupabaseUser();
const callWebsite = useWebsiteAdmin();

interface Member {
  user_id: string;
  email: string;
  role: AdminRole;
  status: "invited" | "active" | "removed";
  invited_at: string;
  joined_at: string | null;
  removed_at: string | null;
  invitation_lapsed: boolean;
  authenticators: number;
  last_sign_in_at: string | null;
}

const members = ref<Member[]>([]);
const loaded = ref(false);
const loadError = ref("");
const announcement = ref("");

async function load() {
  const { data, error } = await supabase.rpc("admin_team");
  loaded.value = true;
  if (error) {
    loadError.value = "The team didn't load. Reload the page to try again.";
    console.error("[team] couldn't load", error);
    return;
  }
  loadError.value = "";
  members.value = (data ?? []) as Member[];
}
onMounted(load);

const current = computed(() => members.value.filter((m) => m.status !== "removed"));
const removed = computed(() => members.value.filter((m) => m.status === "removed"));
const isMe = (m: Member) => m.user_id === user.value?.sub;

function statusText(m: Member) {
  if (m.status === "active") return "Active";
  if (m.status === "removed") return "Removed";
  return m.invitation_lapsed ? "Invitation lapsed" : "Invited";
}
function factorText(m: Member) {
  if (!m.authenticators) return "No authenticator yet";
  return m.authenticators === 1 ? "1 authenticator" : `${m.authenticators} authenticators`;
}

// ---- Inviting ---------------------------------------------------------------
const { handleSubmit, isSubmitting, resetForm, setFieldValue } = useForm<AdminInviteInput>({
  validationSchema: zodSchema(adminInviteSchema),
  initialValues: { email: "", role: "support", reason: "" },
});
const inviteError = ref("");
const inviteDone = ref("");
const invite = handleSubmit(async (v) => {
  inviteError.value = "";
  inviteDone.value = "";
  try {
    await callWebsite("team/invite", { email: v.email, role: v.role, reason: v.reason });
  } catch (e) {
    inviteError.value = (e as Error).message;
    return;
  }
  inviteDone.value = `Invitation sent to ${v.email.trim().toLowerCase()}. It lasts 7 days.`;
  announcement.value = inviteDone.value;
  resetForm();
  await load();
});
/** "Invite again", for a lapsed invitation or someone removed: fills in the form. */
function inviteAgain(m: Member) {
  setFieldValue("email", m.email);
  setFieldValue("role", m.role);
  inviteDone.value = "";
  nextTick(() => document.getElementById("invite-reason")?.focus());
}

// ---- Changing a role, resetting authenticators, removing --------------------
// Which change for whom, kept apart from whether the dialog is open: the
// dialog closes itself on a press, before the change has read its choice.
type Change = { kind: "role"; member: Member; role: AdminRole } | { kind: "reset" | "remove"; member: Member };
const change = ref<Change | null>(null);
const dialogOpen = ref(false);
const busy = ref(false);
const changeError = ref("");

function ask(c: Change) {
  change.value = c;
  changeError.value = "";
  dialogOpen.value = true;
}

const copy = computed(() => {
  const c = change.value;
  if (!c) return { title: "", description: "", confirm: "", destructive: false };
  const who = c.member.email;
  if (c.kind === "role") {
    return c.role === "owner"
      ? { title: `Make ${who} an owner?`, description: "Owners can do everything, including managing the team, guides, settings and money limits. It takes effect at once.", confirm: "Make owner", destructive: false }
      : { title: `Make ${who} support?`, description: "Support can't manage the team, guides, the homepage, categories, markets or settings. It takes effect at once.", confirm: "Make support", destructive: false };
  }
  if (c.kind === "reset") {
    return { title: `Reset ${who}'s authenticators?`, description: "Their authenticators are removed and they're signed out now. At their next sign-in they set up a new one. Use this when they've lost their phone.", confirm: "Reset authenticators", destructive: true };
  }
  return c.member.status === "invited"
    ? { title: `Cancel ${who}'s invitation?`, description: "They won't be able to join. You can invite them again later.", confirm: "Cancel invitation", destructive: true }
    : { title: `Remove ${who} from the team?`, description: "They're signed out now and lose admin access at once. Their past actions stay in the record. You can invite them again later.", confirm: "Remove", destructive: true };
});

// ---- Contact details viewed (admin roles, step 5c) ---------------------------
// Who saw which customer's or provider's contact details, when: the record
// admin_booking_contact and admin_provider_contact keep. Never the details.
const views = ref<AdminContactViewRow[]>([]);
const viewsTotal = ref(0);
const viewsPage = ref(1);
const viewsFor = ref<string>("");
const viewsError = ref("");
const WHAT: Record<AdminContactViewRow["what"], string> = {
  booking_contact: "the customer's email and phone", booking_address: "the Service address", owner_email: "the owner's email",
};
async function loadViews() {
  const { data, error } = await supabase.rpc("admin_contact_views_page", { p_admin_id: viewsFor.value || undefined, p_page: viewsPage.value, p_page_size: 25 });
  if (error) {
    viewsError.value = "The record didn't load. Reload the page to try again.";
    console.error("[team] couldn't load contact views", error);
    return;
  }
  viewsError.value = "";
  const page = rpcJson("admin_contact_views_page", data);
  views.value = page.rows;
  viewsTotal.value = page.total;
}
onMounted(loadViews);
watch(viewsFor, () => {
  viewsPage.value = 1;
  void loadViews();
});
watch(viewsPage, () => void loadViews());
const viewsPages = computed(() => Math.max(1, Math.ceil(viewsTotal.value / 25)));

async function confirm(reason: string) {
  const c = change.value;
  if (!c) return;
  busy.value = true;
  changeError.value = "";
  const { error } = c.kind === "role"
    ? await supabase.rpc("admin_change_role", { p_user_id: c.member.user_id, p_role: c.role, p_reason: reason })
    : c.kind === "reset"
      ? await supabase.rpc("admin_reset_second_factor", { p_user_id: c.member.user_id, p_reason: reason })
      : await supabase.rpc("admin_remove", { p_user_id: c.member.user_id, p_reason: reason });
  busy.value = false;
  if (error) {
    changeError.value = error.message || "That didn't work. Try again.";
    return;
  }
  dialogOpen.value = false;
  announcement.value = c.kind === "role" ? `${c.member.email} is now ${ADMIN_ROLE_LABEL[c.role].toLowerCase()}.`
    : c.kind === "reset" ? `${c.member.email}'s authenticators were reset.` : `${c.member.email} was removed from the team.`;
  await load();
}
</script>

<template>
  <div>
    <PageHeader title="Team" description="Who can use lokl Admin, and as what. Every change is logged and emailed to every owner." />
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <p v-if="loadError" role="alert" class="text-destructive text-sm">{{ loadError }}</p>

    <section class="bg-card border-border rounded-lg border p-5" aria-labelledby="members-heading">
      <h2 id="members-heading" class="font-semibold">Members</h2>
      <p v-if="!loaded" class="text-muted-foreground mt-3 text-sm">Loading…</p>
      <ul v-else class="divide-border mt-3 divide-y">
        <li v-for="m in current" :key="m.user_id" class="flex flex-wrap items-start justify-between gap-3 py-4" :data-testid="`member-${m.email}`">
          <div class="min-w-0">
            <p class="font-medium break-all">{{ m.email }}<span v-if="isMe(m)" class="text-muted-foreground font-normal"> (you)</span></p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <UiBadge variant="outline">{{ ADMIN_ROLE_LABEL[m.role] }}</UiBadge>
              <UiBadge :variant="m.status === 'active' ? 'secondary' : 'outline'">{{ statusText(m) }}</UiBadge>
            </p>
            <p class="text-muted-foreground mt-1 text-sm">
              <template v-if="m.status === 'active' && m.joined_at">Joined {{ formatHomeDate(m.joined_at) }}</template>
              <template v-else>Invited {{ formatHomeDate(m.invited_at) }}</template>
              · {{ factorText(m) }}
              · {{ m.last_sign_in_at ? `Last signed in ${formatHomeDateTime(m.last_sign_in_at)} (Atlanta time)` : "Never signed in" }}
            </p>
          </div>
          <div v-if="!isMe(m)" class="flex flex-wrap gap-2">
            <UiButton v-if="m.status === 'invited'" variant="outline" size="sm" class="min-h-9" @click="inviteAgain(m)">
              Send again<span class="sr-only"> to {{ m.email }}</span>
            </UiButton>
            <UiButton v-if="m.status === 'active'" variant="outline" size="sm" class="min-h-9"
              @click="ask({ kind: 'role', member: m, role: m.role === 'owner' ? 'support' : 'owner' })">
              {{ m.role === "owner" ? "Make support" : "Make owner" }}<span class="sr-only"> for {{ m.email }}</span>
            </UiButton>
            <UiButton v-if="m.status === 'active' && m.authenticators" variant="outline" size="sm" class="min-h-9" @click="ask({ kind: 'reset', member: m })">
              Reset authenticators<span class="sr-only"> for {{ m.email }}</span>
            </UiButton>
            <UiButton variant="outline" size="sm" class="min-h-9" @click="ask({ kind: 'remove', member: m })">
              <template v-if="m.status === 'invited'">Cancel invitation<span class="sr-only"> for {{ m.email }}</span></template>
              <template v-else>Remove<span class="sr-only"> {{ m.email }}</span></template>
            </UiButton>
          </div>
        </li>
      </ul>

      <details v-if="removed.length" class="mt-4">
        <summary class="min-h-11 cursor-pointer py-2 text-sm font-medium">Removed ({{ removed.length }})</summary>
        <ul class="divide-border divide-y">
          <li v-for="m in removed" :key="m.user_id" class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span class="break-all">{{ m.email }} · was {{ ADMIN_ROLE_LABEL[m.role].toLowerCase() }}<template v-if="m.removed_at">, removed {{ formatHomeDate(m.removed_at) }}</template></span>
            <UiButton variant="outline" size="sm" class="min-h-9" @click="inviteAgain(m)">Invite again<span class="sr-only"> {{ m.email }}</span></UiButton>
          </li>
        </ul>
      </details>
    </section>

    <section class="bg-card border-border mt-6 rounded-lg border p-5" aria-labelledby="invite-heading">
      <h2 id="invite-heading" class="font-semibold">Invite someone</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        They get an email. They sign in with that address, set up an authenticator app, then join. The invitation lasts 7 days.
        A login that owns a business on lokl can't be on the team: use a separate email address.
      </p>
      <form class="mt-4 max-w-md space-y-4" novalidate @submit="invite">
        <UiVeeInput name="email" type="email" label="Email address" required autocomplete="off" />
        <UiVeeSelect name="role" label="Role" required :options="[
          { value: 'support', label: 'Support: reports, reviews, listings, bookings' },
          { value: 'owner', label: 'Owner: everything, including the team' },
        ]" />
        <UiVeeTextarea id="invite-reason" name="reason" label="Reason" required :rows="2" maxlength="500" hint="Kept in the team's record. Not emailed." />
        <p v-if="inviteError" role="alert" class="text-destructive text-sm">{{ inviteError }}</p>
        <p v-if="inviteDone" class="text-sm">{{ inviteDone }}</p>
        <UiButton type="submit" class="min-h-11" :disabled="isSubmitting">{{ isSubmitting ? "Sending…" : "Send invitation" }}</UiButton>
      </form>
    </section>

    <section class="bg-card border-border mt-6 rounded-lg border p-5" aria-labelledby="views-heading">
      <h2 id="views-heading" class="font-semibold">Contact details viewed</h2>
      <p class="text-muted-foreground mt-1 text-sm">Each time someone on the team opens a customer's or provider's contact details. Support has a daily limit of different bookings or providers.</p>
      <div class="mt-3 max-w-xs">
        <label for="views-for" class="text-sm font-medium">Who</label>
        <select id="views-for" v-model="viewsFor" class="border-input bg-background mt-1 block min-h-11 w-full rounded-md border px-3 text-sm">
          <option value="">Everyone</option>
          <option v-for="m in members" :key="m.user_id" :value="m.user_id">{{ m.email }}</option>
        </select>
      </div>
      <p v-if="viewsError" role="alert" class="text-destructive mt-3 text-sm">{{ viewsError }}</p>
      <p v-else-if="!views.length" class="text-muted-foreground mt-3 text-sm">No contact details viewed yet.</p>
      <ul v-else class="divide-border mt-3 divide-y text-sm">
        <li v-for="v in views" :key="v.id" class="py-2">
          <span class="text-muted-foreground">{{ formatHomeDateTime(v.viewed_at) }} (Atlanta time) ·</span>
          {{ v.admin_email ?? "Someone" }} saw {{ WHAT[v.what] }} for
          <NuxtLink v-if="v.booking" :to="`/bookings/${v.booking.id}`" class="link-text">{{ v.booking.customer_name }}'s booking of “{{ v.booking.listing_title }}”</NuxtLink>
          <NuxtLink v-else-if="v.provider" :to="`/providers?q=${encodeURIComponent(v.provider.name)}`" class="link-text">{{ v.provider.name }}</NuxtLink>
        </li>
      </ul>
      <div v-if="viewsPages > 1" class="mt-3 flex items-center gap-2 text-sm">
        <UiButton size="sm" variant="outline" :disabled="viewsPage <= 1" @click="viewsPage--">Previous</UiButton>
        <span>Page {{ viewsPage }} of {{ viewsPages }}</span>
        <UiButton size="sm" variant="outline" :disabled="viewsPage >= viewsPages" @click="viewsPage++">Next</UiButton>
      </div>
    </section>

    <ReasonDialog v-model:open="dialogOpen" :title="copy.title" :description="copy.description" :confirm-label="copy.confirm"
      :destructive="copy.destructive" :busy="busy" :error="changeError" hint="Kept in the team's record. Not emailed." @confirm="confirm" />
  </div>
</template>
