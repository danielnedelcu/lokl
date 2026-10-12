<script setup lang="ts">
// "Continue with Google", below the code form in the sign-in dialog and on
// /login (website only; docs/design/sign-in-with-code.md, Google). Google's
// own button (Google Identity Services) opens a Google pop-up, so the person
// stays on the page; the token it returns signs them in through Supabase
// (signInWithIdToken, with a nonce: googleNonce), and then the dialog does
// what it does after a code sign-in.
//
// Shown only when NUXT_PUBLIC_GOOGLE_CLIENT_ID is set. Google's script is
// loaded only now (the dialog or /login is open), never with a page; if it's
// blocked, there's simply no Google button, and the code still works. The
// space for the button is kept from the start, so nothing moves when it
// appears, and focus stays where the form puts it (the email field).
const props = defineProps<{
  /** Run just before signing in (the dialog: what a heart was saving). */
  beforeSignIn?: () => void;
}>();
const emit = defineEmits<{ "signed-in": [email: string] }>();

const clientId = useRuntimeConfig().public.googleClientId as string;
const supabase = useSupabaseClient();
const box = useTemplateRef<HTMLElement>("box");
const status = ref("");
const error = ref("");
let raw = "";

async function prepare() {
  const google = await loadGoogleIdentity();
  const nonce = await googleNonce();
  raw = nonce.raw;
  google.accounts.id.initialize({ client_id: clientId, nonce: nonce.hashed, callback: (r) => void signIn(r.credential), auto_select: false, use_fedcm_for_prompt: true });
  if (!box.value) return;
  box.value.replaceChildren();
  google.accounts.id.renderButton(box.value, {
    type: "standard", theme: "outline", size: "large", shape: "pill", text: "continue_with", logo_alignment: "left",
    width: Math.min(400, Math.max(200, box.value.clientWidth)), locale: "en",
  });
}

async function signIn(credential: string) {
  error.value = "";
  status.value = "Signing you in…";
  props.beforeSignIn?.();
  const { data, error: e } = await supabase.auth.signInWithIdToken({ provider: "google", token: credential, nonce: raw });
  status.value = "";
  if (e || !data.user) {
    error.value = "Google sign-in didn't work. Try again, or use a code.";
    // A nonce is good for one sign-in: a new one for the next try.
    void prepare().catch(() => {});
    return;
  }
  emit("signed-in", data.user.email ?? "");
}

onMounted(() => {
  if (clientId) void prepare().catch(() => {});
});
</script>

<template>
  <div v-if="clientId" class="mt-6">
    <div class="text-muted-foreground flex items-center gap-3 text-sm">
      <span class="bg-border h-px flex-1" aria-hidden="true" />or<span class="bg-border h-px flex-1" aria-hidden="true" />
    </div>
    <!-- Google draws its button here (in a frame), named "Continue with Google". -->
    <div ref="box" class="mt-4 flex min-h-11 justify-center" />
    <p class="sr-only" role="status">{{ status }}</p>
    <p v-if="error" role="alert" class="text-destructive mt-2 text-sm">{{ error }}</p>
  </div>
</template>
