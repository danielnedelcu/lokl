<script setup lang="ts">
// The second step (docs/design/admin-roles.md): after the emailed code, a
// person with an authenticator enters its code before going on. Optional
// for now: only those who've set one up are asked (the middleware sends
// them here). Passing it takes the session to aal2.
definePageMeta({ layout: "auth" });
useHead({ title: "Second step · Admin" });

const supabase = useSupabaseClient();
const route = useRoute();
const { authenticators, needsSecondStep, refresh } = useAuthenticators();
await refresh().catch(() => {});

// Where to go next: a path in this app only.
const next = computed(() => {
  const to = typeof route.query.to === "string" ? route.query.to : "/";
  return to.startsWith("/") && !to.startsWith("//") ? to : "/";
});
if (!needsSecondStep.value) await navigateTo(next.value, { replace: true });

const chosen = ref(authenticators.value[0]?.id ?? "");
const digits = ref<number[]>([]);
const error = ref("");
const busy = ref(false);
const code = computed(() => digits.value.map(String).join(""));

async function verify() {
  error.value = "";
  if (code.value.length !== 6) {
    error.value = "Enter the 6-digit code from your authenticator app.";
    return;
  }
  busy.value = true;
  const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: chosen.value, code: code.value });
  busy.value = false;
  if (e) {
    digits.value = [];
    error.value = "That code didn't work. Codes change every 30 seconds: enter the one showing now.";
    await nextTick();
    document.getElementById("second-step-code")?.focus();
    return;
  }
  await refresh();
  await navigateTo(next.value, { replace: true });
}

// On the sixth digit, focus moves to Continue, as in sign-in: nothing is sent without a press.
const focusContinue = () => nextTick(() => document.getElementById("second-step-continue")?.focus());

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo("/login");
}
</script>

<template>
  <UiCard class="w-full max-w-sm">
    <UiCardHeader>
      <UiCardTitle as="h1">Second step</UiCardTitle>
      <UiCardDescription>Enter the 6-digit code from your authenticator app.</UiCardDescription>
    </UiCardHeader>
    <UiCardContent>
      <form class="space-y-4" novalidate @submit.prevent="verify">
        <fieldset v-if="authenticators.length > 1" class="space-y-2">
          <legend class="text-sm font-medium">Which authenticator?</legend>
          <UiRadioGroup v-model="chosen" class="gap-2">
            <div v-for="a in authenticators" :key="a.id" class="flex items-center gap-2">
              <UiRadioGroupItem :id="`authenticator-${a.id}`" :value="a.id" />
              <UiLabel :for="`authenticator-${a.id}`">{{ a.name }}</UiLabel>
            </div>
          </UiRadioGroup>
        </fieldset>
        <div class="space-y-2">
          <p id="second-step-label" class="text-sm font-medium">6-digit code</p>
          <CodeInput id="second-step-code" v-model="digits" labelledby="second-step-label" :invalid="!!error"
            :describedby="error ? 'second-step-error' : undefined" @complete="focusContinue" />
        </div>
        <p v-if="error" id="second-step-error" role="alert" class="text-destructive text-sm">{{ error }}</p>
        <UiButton id="second-step-continue" type="submit" class="min-h-11 w-full" :disabled="busy">{{ busy ? "Checking…" : "Continue" }}</UiButton>
      </form>
      <p class="text-muted-foreground mt-6 text-sm">
        Lost your authenticator? Use your other one. If you've lost both, the owner can reset them for you.
      </p>
      <button type="button" class="hover:bg-accent -mx-1 mt-2 min-h-11 rounded px-1 text-sm font-medium" @click="signOut">Sign out</button>
    </UiCardContent>
  </UiCard>
</template>
