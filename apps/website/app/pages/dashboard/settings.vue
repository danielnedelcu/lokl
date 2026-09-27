<script setup lang="ts">
definePageMeta({ layout: "dashboard" });

const { data: provider, refresh } = await useProvider();

const form = reactive({
  display_name: provider.value?.display_name ?? "",
  city: provider.value?.city ?? "",
});
const status = ref<"idle" | "saving" | "saved" | "error">("idle");
const errorMessage = ref("");

async function save() {
  status.value = "saving";
  try {
    await $fetch("/api/provider", { method: "POST", body: form });
    await refresh();
    status.value = "saved";
  } catch (e) {
    status.value = "error";
    errorMessage.value = (e as { statusMessage?: string }).statusMessage ?? "Something went wrong. Please try again.";
  }
}
</script>

<template>
  <div class="max-w-lg">
    <h1 class="text-2xl font-semibold tracking-tight">Business profile</h1>
    <p class="mt-1 text-sm text-zinc-500">This is how customers will see you on your listings.</p>

    <form class="mt-6 space-y-4 rounded-lg border border-zinc-200 bg-white p-5" @submit.prevent="save">
      <div>
        <label for="display_name" class="block text-sm font-medium">Business or host name</label>
        <input
          id="display_name"
          v-model="form.display_name"
          required
          minlength="2"
          maxlength="120"
          class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
      </div>
      <div>
        <label for="city" class="block text-sm font-medium">City</label>
        <input
          id="city"
          v-model="form.city"
          maxlength="120"
          placeholder="Atlanta"
          class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
      </div>
      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="status === 'saving'"
          class="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {{ status === "saving" ? "Saving…" : provider ? "Save changes" : "Create profile" }}
        </button>
        <p v-if="status === 'saved'" class="text-sm text-zinc-600" role="status">Saved.</p>
        <p v-if="status === 'error'" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
      </div>
    </form>
  </div>
</template>
