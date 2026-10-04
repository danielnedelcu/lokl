<script setup lang="ts">
import { signInSchema } from "@repo/types";

// Sign in with an emailed 6-digit code, without leaving the page
// (docs/design/sign-in-with-code.md). Used in the website's sign-in dialog,
// on both apps' /login pages. Step 1 asks for the email and sends the code
// (the same email has a link, which still works through /confirm); step 2
// takes the code. Emits "signed-in" once Supabase has a session.
//
// The wrong-code limit here is for people; the real limits are Supabase's
// (the code's 10-minute life, its per-IP verify rate limit), since anyone
// can call its verify endpoint directly.
const props = withDefaults(defineProps<{
  /** Website: true (the first sign-in creates the account). Admin: false. */
  createUser: boolean;
  /** Admin: an unknown address reads the same as any other failure. */
  admin?: boolean;
  /** Show "New to lokl? This creates your account." under the email. */
  newAccountHint?: boolean;
  /** Called just before a code is sent (the dialog saves where the emailed link returns to). */
  beforeSend?: (email: string) => void;
  /** Unique per page, for the fields' ids. */
  idPrefix?: string;
}>(), { admin: false, newAccountHint: false, beforeSend: undefined, idPrefix: "sign-in" });
const emit = defineEmits<{ "signed-in": [email: string] }>();

const supabase = useSupabaseClient();
const step = ref<"email" | "code">("email");
const email = ref("");
const code = ref("");
const sentAt = ref(0);
const wrong = ref(0);
const locked = ref(false);
const error = ref("");
const status = ref("");
const busy = ref(false);
const ids = {
  email: `${props.idPrefix}-email`,
  emailHint: `${props.idPrefix}-email-hint`,
  code: `${props.idPrefix}-code`,
  codeHint: `${props.idPrefix}-code-hint`,
  error: `${props.idPrefix}-error`,
  resend: `${props.idPrefix}-resend`,
  different: `${props.idPrefix}-different`,
};

// The resend countdown: ticks each second while on the code step.
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
watch(step, (s) => {
  clearInterval(ticker);
  if (s === "code") ticker = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => clearInterval(ticker));
const canResend = computed(() => now.value - sentAt.value >= RESEND_AFTER_MS);
// Announced once when it becomes possible, not every second.
watch(canResend, (can) => {
  if (can && step.value === "code") status.value = "You can send a new code now.";
});

function focus(id: string) {
  void nextTick(() => document.getElementById(id)?.focus());
}

async function send() {
  error.value = "";
  const parsed = signInSchema.safeParse({ email: email.value.trim() });
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Enter your email address, like name@example.com.";
    focus(ids.email);
    return;
  }
  busy.value = true;
  props.beforeSend?.(parsed.data.email);
  const { error: e } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: props.createUser, emailRedirectTo: `${window.location.origin}/confirm` },
  });
  busy.value = false;
  if (e) {
    console.error("[sign-in] sending the code failed", e);
    error.value = sendFailedMessage(e, { admin: props.admin });
    return;
  }
  const resending = step.value === "code";
  email.value = parsed.data.email;
  sentAt.value = Date.now();
  now.value = sentAt.value;
  code.value = "";
  wrong.value = 0;
  locked.value = false;
  status.value = resending ? "We sent a new code. The old one no longer works." : "";
  step.value = "code";
  focus(ids.code);
}

async function verify() {
  error.value = "";
  const typed = cleanCode(code.value);
  code.value = typed;
  const early = checkCodeBeforeSending(typed, sentAt.value);
  if (early) {
    error.value = early;
    if (early.includes("expired")) locked.value = true;
    focus(!locked.value ? ids.code : canResend.value ? ids.resend : ids.different);
    return;
  }
  busy.value = true;
  const { error: e } = await supabase.auth.verifyOtp({ email: email.value, token: typed, type: "email" });
  busy.value = false;
  if (e) {
    if (e.code === "otp_expired" || e.status === 403) wrong.value++;
    const refused = codeRefusedMessage(e, wrong.value, sentAt.value);
    error.value = refused.message;
    locked.value = refused.locked;
    // A locked field can't take focus: move to whichever way on is open.
    focus(!refused.locked ? ids.code : canResend.value ? ids.resend : ids.different);
    return;
  }
  emit("signed-in", email.value);
}

function differentEmail() {
  step.value = "email";
  error.value = "";
  status.value = "";
  code.value = "";
  focus(ids.email);
}

const describedBy = (hint: string) => [hint, error.value ? ids.error : ""].filter(Boolean).join(" ") || undefined;
</script>

<template>
  <div>
    <form v-if="step === 'email'" class="space-y-4" novalidate @submit.prevent="send">
      <div class="space-y-2">
        <UiLabel :for="ids.email">Email</UiLabel>
        <UiInput :id="ids.email" v-model="email" type="email" name="email" autocomplete="email" required
          :aria-invalid="!!error || undefined" :aria-describedby="describedBy(newAccountHint ? ids.emailHint : '')" />
        <p v-if="newAccountHint" :id="ids.emailHint" class="text-muted-foreground text-sm">New to lokl? This creates your account.</p>
      </div>
      <p v-if="error" :id="ids.error" role="alert" class="text-destructive text-sm">{{ error }}</p>
      <UiButton type="submit" class="min-h-11 w-full" :disabled="busy">{{ busy ? "Sending…" : "Send me a code" }}</UiButton>
    </form>

    <form v-else class="space-y-4" novalidate @submit.prevent="verify">
      <p :id="ids.codeHint" class="text-sm">
        We sent a 6-digit code to <strong class="break-all">{{ email }}</strong>. It works for 10 minutes.
        The email also has a link, if you'd rather use that.
      </p>
      <div class="space-y-2">
        <UiLabel :for="ids.code">6-digit code</UiLabel>
        <UiInput :id="ids.code" v-model="code" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 -]*"
          :maxlength="9" spellcheck="false" :disabled="locked" :aria-invalid="!!error || undefined" :aria-describedby="describedBy(ids.codeHint)"
          class="h-12 text-center font-mono text-2xl tracking-[0.4em]" />
      </div>
      <p v-if="error" :id="ids.error" role="alert" class="text-destructive text-sm">{{ error }}</p>
      <UiButton type="submit" class="min-h-11 w-full" :disabled="busy || locked">{{ busy ? "Checking…" : "Sign in" }}</UiButton>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button :id="ids.different" type="button" class="hover:bg-accent -mx-1 min-h-11 rounded px-1 font-medium" @click="differentEmail">Use a different email</button>
        <button :id="ids.resend" type="button" class="hover:bg-accent -mx-1 min-h-11 rounded px-1 font-medium disabled:text-muted-foreground disabled:hover:bg-transparent"
          :disabled="!canResend || busy" @click="send">{{ resendLabel(sentAt, now) }}</button>
      </div>
      <p class="sr-only" aria-live="polite" aria-atomic="true">{{ status }}</p>
    </form>
  </div>
</template>
