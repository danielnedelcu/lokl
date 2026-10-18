<script setup lang="ts">
import { authenticatorNameProblem, authenticatorRemoval, AUTHENTICATOR_ISSUER, AUTHENTICATOR_NAME_MAX, groupedKey } from "@repo/types";

// Your second factor (docs/design/admin-roles.md, cutover steps 2 and 4): set
// up an authenticator app, add a backup, remove one. Required for admin
// access since step 4; a team member without one is sent here first.
// Open to team members, invited or active, with or without a role yet (an
// invited member sets up before joining): it shows only their own
// authenticators, and without a role the page has no admin frame (the
// middleware's "account" layout).
// - The QR code is Supabase's own SVG, drawn here from its response; nothing
//   is fetched from another site.
// - The key is shown only while setting up, in groups of four, with Copy and,
//   on phones, a link that opens the authenticator app. It's never shown
//   again (Supabase doesn't give it back), and is dropped once set up.
// - Adding a second authenticator or removing one needs the second step
//   first (Supabase refuses otherwise); removing your last is refused
//   (authenticatorRemoval).
useHead({ title: "Second factor · Admin" });

const supabase = useSupabaseClient();
const { authenticators, level, loaded, refresh } = useAuthenticators();
const loadError = ref("");

// A set-up left half-way (enrolled, never confirmed) is cleared, so its
// name is free again and its key goes nowhere.
async function clearUnfinished() {
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
}
onMounted(async () => {
  try {
    await clearUnfinished();
    await refresh();
  } catch {
    loadError.value = "Your authenticators didn't load. Reload the page to try again.";
  }
});

/** Changing authenticators once you have one needs the second step first. */
const mustPassSecondStep = computed(() => authenticators.value.length > 0 && level.value.current !== "aal2");

// ---- Setting one up ---------------------------------------------------------
type Setup = { step: "name" } | { step: "scan"; factorId: string; name: string; qr: string; key: string; uri: string };
const setup = ref<Setup | null>(null);
const name = ref("");
const nameError = ref("");
const digits = ref<number[]>([]);
const codeError = ref("");
const busy = ref(false);
const copied = ref("");
const done = ref("");

function start() {
  done.value = "";
  name.value = authenticators.value.length ? "" : "Phone";
  nameError.value = "";
  setup.value = { step: "name" };
  nextTick(() => document.getElementById("authenticator-name")?.focus());
}

async function enrol() {
  nameError.value = authenticatorNameProblem(name.value, authenticators.value.map((a) => a.name)) ?? "";
  if (nameError.value) return;
  busy.value = true;
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: name.value.trim(), issuer: AUTHENTICATOR_ISSUER });
  busy.value = false;
  if (error || !data) {
    nameError.value = error?.code === "insufficient_aal"
      ? "Pass the second step first, then add another authenticator."
      : "That didn't work. Try again in a moment.";
    return;
  }
  setup.value = { step: "scan", factorId: data.id, name: name.value.trim(), qr: data.totp.qr_code, key: data.totp.secret, uri: data.totp.uri };
  digits.value = [];
  codeError.value = "";
  copied.value = "";
  await nextTick();
  document.getElementById("setup-heading")?.focus();
}

async function copyKey() {
  if (setup.value?.step !== "scan") return;
  try {
    await navigator.clipboard.writeText(setup.value.key);
    copied.value = "Key copied.";
  } catch {
    copied.value = "Couldn't copy: select the key and copy it instead.";
  }
}

async function confirmCode() {
  if (setup.value?.step !== "scan") return;
  const code = digits.value.map(String).join("");
  if (code.length !== 6) {
    codeError.value = "Enter the 6-digit code your authenticator app shows.";
    return;
  }
  busy.value = true;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.value.factorId, code });
  busy.value = false;
  if (error) {
    digits.value = [];
    codeError.value = "That code didn't work. Check the app shows lokl, and enter the code showing now.";
    return;
  }
  done.value = `${setup.value.name} is set up.`;
  setup.value = null; // the key and QR code are dropped here, never shown again
  await refresh();
  await nextTick();
  document.getElementById("authenticators-heading")?.focus();
}

async function cancel() {
  if (setup.value?.step === "scan") await supabase.auth.mfa.unenroll({ factorId: setup.value.factorId });
  setup.value = null;
}
onBeforeUnmount(() => { if (setup.value?.step === "scan") void supabase.auth.mfa.unenroll({ factorId: setup.value.factorId }); });

/** On the sixth digit, focus moves to the button, as in sign-in: nothing is sent without a press (submitting by itself disorients screen readers). */
const focusById = (id: string) => nextTick(() => document.getElementById(id)?.focus());

// ---- Removing one -----------------------------------------------------------
// Which one, kept apart from whether the dialog is open: the dialog closes
// itself on a press, before the removal has read its choice.
const removing = ref<{ id: string; name: string } | null>(null);
const removeOpen = ref(false);
const removal = computed(() => authenticatorRemoval(authenticators.value.length));
const removeError = ref("");

async function remove() {
  const target = removing.value;
  removeOpen.value = false;
  if (!target) return;
  busy.value = true;
  const { error } = await supabase.auth.mfa.unenroll({ factorId: target.id });
  busy.value = false;
  if (error) {
    removeError.value = error.code === "insufficient_aal" ? "Pass the second step first, then remove it." : "That didn't work. Try again in a moment.";
    return;
  }
  done.value = `${target.name} is removed.`;
  await refresh();
}
</script>

<template>
  <div class="max-w-2xl">
    <PageHeader title="Second factor"
      description="An authenticator app gives you a 6-digit code that changes every 30 seconds. After the emailed code, you enter it as a second step, so your inbox alone can't open lokl's admin." />

    <p v-if="loadError" role="alert" class="text-destructive text-sm">{{ loadError }}</p>
    <p class="sr-only" aria-live="polite">{{ done }}</p>

    <UiAlert v-if="mustPassSecondStep" class="mb-6">
      <UiAlertTitle>Pass the second step to change your authenticators</UiAlertTitle>
      <UiAlertDescription>
        You signed in with the emailed code only.
        <NuxtLink to="/security/verify?to=/security" class="link-text">Enter a code from your authenticator</NuxtLink>
        to add or remove one.
      </UiAlertDescription>
    </UiAlert>

    <section class="bg-card border-border rounded-lg border p-5" aria-labelledby="authenticators-heading">
      <h2 id="authenticators-heading" tabindex="-1" class="font-semibold outline-none">Your authenticators</h2>
      <p v-if="done" class="mt-2 text-sm">{{ done }}</p>
      <p v-if="!loaded" class="text-muted-foreground mt-3 text-sm">Loading…</p>
      <template v-else>
        <p v-if="!authenticators.length" class="text-muted-foreground mt-3 text-sm">
          None yet. Admin access needs one: set it up now. Then add a second (say, your phone and a password manager), so losing one doesn't lock you out.
        </p>
        <ul v-else class="divide-border mt-3 divide-y">
          <li v-for="a in authenticators" :key="a.id" class="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p class="font-medium">{{ a.name }}</p>
              <p class="text-muted-foreground text-sm">Added {{ formatHomeDate(a.createdAt) }}</p>
            </div>
            <UiButton variant="outline" size="sm" class="min-h-9" :disabled="mustPassSecondStep" @click="removeError = ''; removing = { id: a.id, name: a.name }; removeOpen = true">
              Remove<span class="sr-only"> {{ a.name }}</span>
            </UiButton>
          </li>
        </ul>
        <p v-if="authenticators.length === 1 && !setup" class="mt-3 text-sm">Add a second one, so losing this one doesn't lock you out.</p>
        <p v-if="removeError" role="alert" class="text-destructive mt-3 text-sm">{{ removeError }}</p>
        <UiButton v-if="!setup" class="mt-4 min-h-11" :disabled="mustPassSecondStep" @click="start">
          {{ authenticators.length ? "Add another authenticator" : "Set up an authenticator" }}
        </UiButton>
      </template>
    </section>

    <section v-if="setup" class="bg-card border-border mt-6 rounded-lg border p-5" aria-labelledby="setup-heading">
      <h2 id="setup-heading" tabindex="-1" class="font-semibold outline-none">
        {{ setup.step === "name" ? "Set up an authenticator" : `Add lokl to ${setup.name}` }}
      </h2>

      <form v-if="setup.step === 'name'" class="mt-4 space-y-4" novalidate @submit.prevent="enrol">
        <div class="space-y-2">
          <UiLabel for="authenticator-name">Name it</UiLabel>
          <UiInput id="authenticator-name" v-model="name" :maxlength="AUTHENTICATOR_NAME_MAX" autocomplete="off"
            aria-describedby="authenticator-name-hint" :aria-invalid="!!nameError || undefined" />
          <p id="authenticator-name-hint" class="text-muted-foreground text-sm">So you know which is which, such as Phone or Password manager.</p>
          <p v-if="nameError" role="alert" class="text-destructive text-sm">{{ nameError }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UiButton type="submit" class="min-h-11" :disabled="busy">{{ busy ? "Starting…" : "Continue" }}</UiButton>
          <UiButton type="button" variant="outline" class="min-h-11" @click="cancel">Cancel</UiButton>
        </div>
      </form>

      <div v-else class="mt-4 space-y-5">
        <ol class="list-decimal space-y-4 pl-5 text-sm">
          <li>
            In your authenticator app, add an account by scanning this QR code.
            <!-- Supabase's own SVG, drawn here; no outside QR service. -->
            <img :src="setup.qr" alt="QR code for your authenticator app. If you can't scan it, use the key below instead." class="mt-3 size-44 rounded bg-white p-2" >
          </li>
          <li>
            Or type this key into the app instead:
            <p class="mt-2 flex flex-wrap items-center gap-2">
              <code id="authenticator-key" class="bg-muted rounded px-2 py-1 font-mono text-base tracking-wider" aria-label="Key">{{ groupedKey(setup.key) }}</code>
              <UiButton type="button" variant="outline" size="sm" class="min-h-9" @click="copyKey">Copy<span class="sr-only"> the key</span></UiButton>
            </p>
            <p class="text-muted-foreground mt-1" aria-live="polite">{{ copied }}</p>
            <!-- On a phone, the app on the same phone can take it directly. -->
            <a :href="setup.uri" class="link-text mt-2 inline-flex min-h-6 items-center sm:hidden">Open in authenticator app</a>
          </li>
          <li>Enter the 6-digit code the app now shows for lokl.</li>
        </ol>
        <form class="space-y-4" novalidate @submit.prevent="confirmCode">
          <div class="space-y-2">
            <p id="setup-code-label" class="text-sm font-medium">6-digit code</p>
            <CodeInput id="setup-code" v-model="digits" labelledby="setup-code-label" :invalid="!!codeError"
              :describedby="codeError ? 'setup-code-error' : undefined" @complete="focusById('setup-confirm')" />
          </div>
          <p v-if="codeError" id="setup-code-error" role="alert" class="text-destructive text-sm">{{ codeError }}</p>
          <div class="flex flex-wrap gap-2">
            <UiButton id="setup-confirm" type="submit" class="min-h-11" :disabled="busy">{{ busy ? "Checking…" : "Confirm" }}</UiButton>
            <UiButton type="button" variant="outline" class="min-h-11" @click="cancel">Cancel</UiButton>
          </div>
        </form>
        <p class="text-muted-foreground text-sm">This key is shown only now. Once confirmed, it isn't shown again.</p>
      </div>
    </section>

    <UiAlertDialog v-model:open="removeOpen" :title="`Remove ${removing?.name ?? 'this authenticator'}?`"
      :description="removal.warning ?? 'You can still sign in with your other authenticator.'">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiAlertDialogAction v-if="removal.allowed" text="Remove" variant="destructive" :disabled="busy" @click.prevent="remove" />
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
  </div>
</template>
