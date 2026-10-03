<script setup lang="ts">
import { z } from "zod";

// One dialog for every admin action that needs a reason (refund, cancel,
// release a payout, resolve a report, suspend). The reason is logged with
// the action. Its own component, so its form never mixes with a page's.
const props = defineProps<{
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  error: string;
  hint?: string;
  /** Adds an optional "message to the provider" field (suspend, reinstate). */
  messageLabel?: string;
  messageHint?: string;
  reasonLabel?: string;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ confirm: [reason: string, message: string] }>();

const { handleSubmit, resetForm } = useForm<{ reason: string; message: string }>({
  validationSchema: zodSchema(z.object({
    reason: z.string().trim().min(5, "Say why, in a few words.").max(1000, "Keep it under 1,000 characters."),
    message: z.string().trim().max(1000, "Keep it under 1,000 characters.").optional(),
  })),
  initialValues: { reason: "", message: "" },
});
watch(open, (o) => o && resetForm());
const submit = handleSubmit((v) => emit("confirm", v.reason.trim(), (v.message ?? "").trim()));
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent>
      <UiDialogHeader>
        <UiDialogTitle>{{ title }}</UiDialogTitle>
        <UiDialogDescription>{{ description }}</UiDialogDescription>
      </UiDialogHeader>
      <form class="space-y-3" novalidate @submit="submit">
        <UiVeeTextarea name="reason" :label="props.reasonLabel ?? 'Reason'" required :rows="3" maxlength="1000" :hint="props.hint ?? 'Kept with the booking\'s history.'" />
        <UiVeeTextarea v-if="props.messageLabel" name="message" :label="props.messageLabel" :rows="3" maxlength="1000" :hint="props.messageHint" />
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <UiDialogFooter>
          <UiButton type="button" variant="outline" @click="open = false">Cancel</UiButton>
          <UiButton type="submit" :variant="destructive ? 'destructive' : 'default'" :disabled="busy">{{ busy ? "Working…" : confirmLabel }}</UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
