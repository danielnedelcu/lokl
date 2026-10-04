<script setup lang="ts">
import { PROFILE_RULES, type ProfileRule } from "@repo/types";

// A provider's public profile, for the admin (docs/design/provider-profiles.md,
// The admin): the photos, headline and bio, and removing any part that
// breaks a profile rule. The removal goes through the website (it deletes
// files and emails the provider), with an internal reason, the rule it
// broke, and an optional message for the provider; all logged.
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ providerId: string | null }>();
const emit = defineEmits<{ changed: [] }>();

const supabase = useSupabaseClient();
const call = useWebsiteAdmin();
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
  parts.value = [];
  rule.value = "";
  reason.value = "";
  message.value = "";
  formError.value = "";
}
const toggle = (part: Part, on: boolean) => (parts.value = on ? [...parts.value, part] : parts.value.filter((p) => p !== part));
const ruleOptions = [{ value: "", label: "Choose a rule" }, ...Object.entries(PROFILE_RULES).map(([value, label]) => ({ value, label }))];

async function remove() {
  formError.value = "";
  if (!parts.value.length) return void (formError.value = "Choose what to remove.");
  if (!rule.value) return void (formError.value = "Choose the rule it breaks.");
  if (reason.value.trim().length < 5) return void (formError.value = "Say why, in a few words. It's kept in the provider's history.");
  busy.value = true;
  try {
    await call(`providers/${props.providerId}/remove-profile-content`, {
      parts: parts.value, rule: rule.value, reason: reason.value, message: message.value || undefined,
    });
    useSonner.success(`Removed from ${profile.value?.display_name}'s profile. They've been emailed.`);
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

            <form v-if="present.length" class="border-border space-y-4 border-t pt-4" novalidate @submit.prevent="remove">
              <h3 class="font-medium">Remove something that breaks the profile rules</h3>
              <fieldset class="space-y-1">
                <legend class="mb-1 text-sm font-medium">What to remove</legend>
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
              <UiButton type="submit" variant="destructive" :disabled="busy">{{ busy ? "Removing…" : "Remove and email the provider" }}</UiButton>
            </form>
            <p v-else class="text-muted-foreground border-border border-t pt-4 text-sm">Nothing to remove: the profile has no photos, headline or about text.</p>
          </template>
        </div>
      </template>
    </UiSheetContent>
  </UiSheet>
</template>
