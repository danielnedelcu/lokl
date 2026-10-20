<script setup lang="ts">
import { PROFILE_RULES, type ProfileRule } from "@repo/types";

// A provider's public profile, for the admin (docs/design/provider-profiles.md,
// The admin): the photos, headline and bio, and hiding any part that
// breaks a profile rule (admin roles step 5e). Hiding takes it off the
// profile at once and keeps it for the owner's decision (the queue on
// Requests); the owner may instead remove it now (the files and text are
// deleted). Both go through the website (files move, the provider is
// emailed), with an internal reason, the rule, and an optional message;
// all logged. The database refuses support's removal either way.
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ providerId: string | null }>();
const emit = defineEmits<{ changed: [] }>();

const supabase = useSupabaseClient();
const call = useWebsiteAdmin();
const role = useAdminRole();
const isOwner = computed(() => role.value === "owner");
// The owner may remove at once; hiding for review is the default for both.
const mode = ref<"hide" | "remove">("hide");
const websiteUrl = useRuntimeConfig().public.websiteUrl.replace(/\/$/, "");
const photoUrl = (path: string | null) => (path ? supabase.storage.from("provider-photos").getPublicUrl(path).data.publicUrl : null);

interface Profile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio: string | null;
  avatar_path: string | null;
  cover_path: string | null;
}
const profile = ref<Profile | null>(null);
const loadError = ref("");
async function load() {
  if (!props.providerId) return;
  loadError.value = "";
  const { data, error } = await supabase.from("providers").select("id, display_name, slug, headline, bio, avatar_path, cover_path").eq("id", props.providerId).single();
  if (error) loadError.value = reportProblem("The profile didn't load. Try again.", error);
  profile.value = (data as Profile | null) ?? null;
}
watch(() => [open.value, props.providerId], () => {
  if (open.value) {
    reset();
    void load();
  }
});

// The removal form.
const PART_LABELS = { avatar: "Profile photo", cover: "Cover photo", headline: "Headline", bio: "About text (bio)" } as const;
type Part = keyof typeof PART_LABELS;
const present = computed<Part[]>(() => {
  const p = profile.value;
  if (!p) return [];
  return (["avatar", "cover", "headline", "bio"] as const).filter((k) =>
    k === "avatar" ? !!p.avatar_path : k === "cover" ? !!p.cover_path : !!p[k]);
});
const parts = ref<Part[]>([]);
const rule = ref<ProfileRule | "">("");
const reason = ref("");
const message = ref("");
const busy = ref(false);
const formError = ref("");
function reset() {
  mode.value = "hide";
  parts.value = [];
  rule.value = "";
  reason.value = "";
  message.value = "";
  formError.value = "";
}
const toggle = (part: Part, on: boolean) => (parts.value = on ? [...parts.value, part] : parts.value.filter((p) => p !== part));
const ruleOptions = [{ value: "", label: "Choose a rule" }, ...Object.entries(PROFILE_RULES).map(([value, label]) => ({ value, label }))];

async function submit() {
  formError.value = "";
  const removing = mode.value === "remove" && isOwner.value;
  if (!parts.value.length) return void (formError.value = removing ? "Choose what to remove." : "Choose what to hide.");
  if (!rule.value) return void (formError.value = "Choose the rule it breaks.");
  if (reason.value.trim().length < 5) return void (formError.value = "Say why, in a few words. It's kept in the provider's history.");
  busy.value = true;
  try {
    const { result } = await call<{ result: string }>(`providers/${props.providerId}/${removing ? "remove" : "hide"}-profile-content`, {
      parts: parts.value, rule: rule.value, reason: reason.value, message: message.value || undefined,
    });
    if (removing) useSonner.success(`Removed from ${profile.value?.display_name}'s profile. They've been emailed.`);
    else if (result.includes("still public")) useSonner.warning("Hidden from the profile, but a photo's file is still at its public address. Try again from Requests.");
    else useSonner.success(`Hidden from ${profile.value?.display_name}'s profile. They've been emailed${isOwner.value ? "" : ", and the owner will decide"}.`);
    reset();
    await load();
    emit("changed");
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UiSheet v-model:open="open">
    <UiSheetContent side="right" class="w-full gap-0 sm:max-w-lg" :title="profile ? `${profile.display_name}'s profile` : 'Profile'"
      description="What customers see on their listings and public profile.">
      <template #content>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8">
          <UiAlert v-if="loadError" variant="destructive"><UiAlertTitle>{{ loadError }}</UiAlertTitle></UiAlert>
          <template v-else-if="profile">
            <div class="bg-muted aspect-[3/1] w-full overflow-hidden rounded-lg">
              <img v-if="profile.cover_path" :src="photoUrl(profile.cover_path)!" alt="Their cover photo" class="h-full w-full object-cover">
            </div>
            <div class="flex items-center gap-3">
              <img v-if="profile.avatar_path" :src="photoUrl(profile.avatar_path)!" alt="Their profile photo" class="size-16 rounded-full object-cover">
              <span v-else class="text-muted-foreground text-sm">No profile photo.</span>
              <div>
                <p class="font-medium">{{ profile.display_name }}</p>
                <p class="text-sm">{{ profile.headline || "No headline." }}</p>
              </div>
            </div>
            <p class="text-sm whitespace-pre-line">{{ profile.bio || "No about text." }}</p>
            <a :href="`${websiteUrl}/providers/${profile.slug}`" target="_blank" rel="noopener" class="text-sm font-medium">
              Open the public profile (if it's public)
            </a>

            <ProviderAvailability :key="profile.id" :provider-id="profile.id" />

            <NuxtLink :to="`/providers/${profile.id}`" class="block text-sm font-medium">Open their page: hidden content and history</NuxtLink>

            <form v-if="present.length" class="border-border space-y-4 border-t pt-4" novalidate @submit.prevent="submit">
              <h3 class="font-medium">Hide something that breaks the profile rules</h3>
              <p class="text-muted-foreground text-sm">
                It comes off their profile at once and is kept until {{ isOwner ? "you decide" : "the owner decides" }} to remove or restore it. Nothing is deleted yet.
              </p>
              <fieldset v-if="isOwner" class="space-y-1">
                <legend class="mb-1 text-sm font-medium">How</legend>
                <label class="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
                  <input v-model="mode" type="radio" value="hide" class="size-4"> Hide it for review
                </label>
                <label class="flex min-h-9 cursor-pointer items-center gap-3 text-sm">
                  <input v-model="mode" type="radio" value="remove" class="size-4"> Remove it now (the files and text are deleted)
                </label>
              </fieldset>
              <fieldset class="space-y-1">
                <legend class="mb-1 text-sm font-medium">{{ mode === "remove" && isOwner ? "What to remove" : "What to hide" }}</legend>
                <label v-for="part in present" :key="part" class="flex min-h-9 cursor-pointer items-center gap-3">
                  <UiCheckbox :model-value="parts.includes(part)" @update:model-value="(v: boolean | 'indeterminate') => toggle(part, v === true)" />
                  <span class="text-sm">{{ PART_LABELS[part] }}</span>
                </label>
              </fieldset>
              <div>
                <UiLabel for="profile-rule" class="mb-1">The rule it breaks</UiLabel>
                <SelectInput id="profile-rule" v-model="rule" :options="ruleOptions" />
                <p class="text-muted-foreground mt-1 text-sm">Named in the provider's email. Apply the rules the same way to everyone.</p>
              </div>
              <div>
                <UiLabel for="profile-reason" class="mb-1">Reason (lokl only)</UiLabel>
                <UiTextarea id="profile-reason" v-model="reason" :rows="2" :maxlength="1000" />
              </div>
              <div>
                <UiLabel for="profile-message" class="mb-1">Message to the provider (optional)</UiLabel>
                <UiTextarea id="profile-message" v-model="message" :rows="3" :maxlength="1000" />
              </div>
              <p v-if="formError" class="text-destructive text-sm" role="alert">{{ formError }}</p>
              <UiButton type="submit" variant="destructive" :disabled="busy">
                {{ busy ? "Saving…" : mode === "remove" && isOwner ? "Remove and email the provider" : "Hide and email the provider" }}
              </UiButton>
            </form>
            <p v-else class="text-muted-foreground border-border border-t pt-4 text-sm">Nothing to hide: the profile has no photos, headline or about text.</p>
          </template>
        </div>
      </template>
    </UiSheetContent>
  </UiSheet>
</template>
