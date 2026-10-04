<script setup lang="ts">
import { REVIEW_RULES, REVIEW_RULE_KEYS, reportSchema, reviewProblem, type ReportReason } from "@repo/types";

// Reporting a review or a reply (docs/design/reviews.md, Reporting): which
// written rule it breaks, and an optional note. The review stays up while
// lokl looks at it. Signed in only (the caller opens the sign-in dialog
// first); one report per person per review and reply.
const props = defineProps<{ reviewId: string; target: "review" | "reply"; name: string }>();
const open = defineModel<boolean>("open", { required: true });
const supabase = useSupabaseClient();
const rule = ref<ReportReason | undefined>();
const note = ref("");
const error = ref("");
const busy = ref(false);
watch(open, (o) => {
  if (o) {
    rule.value = undefined;
    note.value = "";
    error.value = "";
  }
});
const reasons: { value: ReportReason; title: string; text?: string }[] = [
  ...REVIEW_RULE_KEYS.map((k) => ({ value: k, title: REVIEW_RULES[k].title, text: REVIEW_RULES[k].text })),
  { value: "something_else", title: "Something else" },
];

async function send() {
  error.value = "";
  const parsed = reportSchema.safeParse({ rule: rule.value, note: note.value });
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Choose which rule it breaks.";
    return;
  }
  busy.value = true;
  const { data, error: e } = await supabase.from("review_reports")
    .insert({ review_id: props.reviewId, target: props.target, rule: parsed.data.rule, note: parsed.data.note || null })
    .select("id");
  busy.value = false;
  if (e || !data?.length) {
    error.value = reviewProblem(e, "report");
    return;
  }
  open.value = false;
  useSonner.success("Thanks. We'll look at it against our review rules.");
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="sm:max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Report {{ target === "reply" ? `the reply to ${name}'s review` : `${name}'s review` }}</UiDialogTitle>
        <UiDialogDescription>
          It stays up while we look at it against our <NuxtLink to="/review-rules" class="font-medium" target="_blank">review rules</NuxtLink>.
          We never remove a review for being negative.
        </UiDialogDescription>
      </UiDialogHeader>
      <form class="space-y-4" novalidate @submit.prevent="send">
        <div class="space-y-2">
          <p id="report-rule-label" class="text-sm font-medium">Which rule does it break?</p>
          <UiRadioGroup v-model="rule" aria-labelledby="report-rule-label" class="gap-2">
            <label v-for="r in reasons" :key="r.value" class="hover:bg-accent flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-2">
              <UiRadioGroupItem :value="r.value" class="mt-0.5" />
              <span class="text-sm">
                <span class="font-medium">{{ r.title }}</span>
                <span v-if="r.text" class="text-muted-foreground block">{{ r.text }}</span>
              </span>
            </label>
          </UiRadioGroup>
        </div>
        <div class="space-y-2">
          <UiLabel for="report-note">Anything we should know? (optional)</UiLabel>
          <UiTextarea id="report-note" v-model="note" :rows="3" :maxlength="1000" />
        </div>
        <p v-if="error" role="alert" class="text-destructive text-sm">{{ error }}</p>
        <UiDialogFooter>
          <UiButton type="button" variant="outline" @click="open = false">Cancel</UiButton>
          <UiButton type="submit" :disabled="busy">{{ busy ? "Sending…" : "Send report" }}</UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
