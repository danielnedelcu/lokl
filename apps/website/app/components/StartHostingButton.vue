<script setup lang="ts">
// "Get started" (the host card) and "Start hosting" (the hosting section):
// on to the dashboard. Signed in, a plain link there; signed out, a button
// that opens the sign-in dialog, which goes there after signing in (and so
// does the emailed link) (docs/design/sign-in-with-code.md, Destinations).
defineProps<{ label: string; class?: string }>();
const user = useSupabaseUser();
const signIn = useSignIn();
</script>

<template>
  <NuxtLink v-if="user" to="/dashboard" :class="$props.class">{{ label }}</NuxtLink>
  <button v-else type="button" aria-haspopup="dialog" :class="$props.class"
    @click="signIn.open({ title: 'Sign in or sign up to start hosting', goTo: '/dashboard' })">
    {{ label }}
  </button>
</template>
