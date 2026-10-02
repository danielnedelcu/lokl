<script setup lang="ts">
import { z } from "zod";

// Cancelling a session that has bookings: everyone is refunded in full and
// sees the reason (decision 12). Its own component so its form doesn't mix
// with the session form in ListingSessions.
const props = defineProps<{ when: string; booked: number; refundCents: number; busy: boolean; error: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ confirm: [reason: string] }>();

const { handleSubmit, resetForm } = useForm<{ reason: string }>({
  validationSchema: zodSchema(z.object({
    reason: z.string().trim().min(5, "Say why you're cancelling. Customers see it.").max(1000, "Keep it under 1,000 characters."),
  })),
  initialValues: { reason: "" },
});
watch(open, (o) => o && resetForm());
const submit = handleSubmit((v) => emit("confirm", v.reason.trim()));
const people = computed(() => (props.booked === 1 ? "1 person is" : `${props.booked} people are`));
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent>
      <UiDialogHeader>
        <UiDialogTitle>Cancel the session on {{ when }}?</UiDialogTitle>
        <UiDialogDescription>
          This cancels it for everyone. {{ people }} booked, and each gets a full refund
          ({{ formatMoney(refundCents, "usd") }} in total). Anyone paying right now is stopped. This can't be undone.
        </UiDialogDescription>
      </UiDialogHeader>
      <form class="space-y-3" novalidate @submit="submit">
        <UiVeeTextarea name="reason" label="Why are you cancelling?" required :rows="3" maxlength="1000"
          hint="Everyone booked sees this." />
        <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
        <UiDialogFooter>
          <UiButton type="button" variant="outline" @click="open = false">Keep session</UiButton>
          <UiButton type="submit" variant="destructive" :disabled="busy">{{ busy ? "Cancelling…" : "Cancel and refund everyone" }}</UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
