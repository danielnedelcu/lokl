<script setup lang="ts">
import {
  REPLY_MAX, REVIEW_MAX, REVIEW_RULES, replySchema, reviewProblem, reviewSchema, reviewStarsSpoken, whyNoReview, type ReviewRule,
} from "@repo/types";

// A booking's review, on its booking page (docs/design/reviews.md): for the
// customer, the form while the booking qualifies, then their review with
// Edit and Delete until 14 days after the end; for the provider, the review
// and their one public reply. Everything comes from review_state(), which
// says what each may do and the name the review shows. Writes go straight
// to the database, whose rules decide (the form checks first).
const props = defineProps<{ bookingId: string; timezone: string; listingTitle: string; listingPath: string | null; providerName: string }>();

interface State {
  role: "customer" | "provider" | "admin";
  window_ends_at: string | null;
  can_write: boolean;
  why_not: string | null;
  reviewer_name: string;
  review: {
    id: string; rating: number; body: string; created_at: string; edited_at: string | null;
    status: "published" | "removed"; removed_rule: ReviewRule | null; can_change: boolean;
  } | null;
  reply: { body: string; created_at: string; edited_at: string | null; status: "published" | "removed"; removed_rule: ReviewRule | null } | null;
}

const supabase = useSupabaseClient();
const { data: state, refresh } = await useAsyncData(`review-state-${props.bookingId}`, async () => {
  const { data, error } = await supabase.rpc("review_state", { p_booking_id: props.bookingId });
  if (error) throw error;
  return data as unknown as State | null;
}, { server: false });

const until = computed(() => (state.value?.window_ends_at ? formatSessionDate(state.value.window_ends_at, props.timezone) : ""));
const why = computed(() => whyNoReview(state.value?.why_not ?? null, state.value?.window_ends_at ?? null, (iso) => formatSessionDate(iso, props.timezone)));
const ruleTitle = (r: ReviewRule | null) => (r ? REVIEW_RULES[r].title.toLowerCase() : "");

// ---------------------------------------------------------------------------
// The customer: write, edit, delete
// ---------------------------------------------------------------------------
const editing = ref(false);
const rating = ref<number | null>(null);
const body = ref("");
const error = ref("");
const busy = ref(false);
const showForm = computed(() => state.value?.role === "customer" && (state.value.can_write || editing.value));
function startEdit() {
  rating.value = state.value?.review?.rating ?? null;
  body.value = state.value?.review?.body ?? "";
  error.value = "";
  editing.value = true;
  void nextTick(() => document.getElementById("review-rating")?.focus());
}
async function save() {
  error.value = "";
  const parsed = reviewSchema.safeParse({ rating: rating.value ?? 0, body: body.value });
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? "Check your review.";
    return;
  }
  busy.value = true;
  const id = state.value?.review?.id;
  const result = editing.value && id
    ? await supabase.from("reviews").update({ rating: parsed.data.rating, body: parsed.data.body }).eq("id", id).select("id")
    // Cast: the generated types list the columns the trigger fills from the
    // booking (listing, provider, customer, name, month) as required.
    : await supabase.from("reviews").insert({ booking_id: props.bookingId, rating: parsed.data.rating, body: parsed.data.body } as never).select("id");
  busy.value = false;
  const problemFound = changedRows(result, "saved");
  if (problemFound) {
    error.value = problemText(problemFound, reviewProblem(result.error, "review"));
    return;
  }
  useSonner.success(editing.value ? "Your review is updated." : "Thanks. Your review is up.");
  editing.value = false;
  await refresh();
  void nextTick(() => document.getElementById("review-heading")?.focus());
}

const deleteOpen = ref(false);
async function deleteReview() {
  const id = state.value?.review?.id;
  if (!id) return;
  busy.value = true;
  const result = await supabase.from("reviews").delete().eq("id", id).select("id");
  busy.value = false;
  deleteOpen.value = false;
  const problemFound = changedRows(result, "deleted");
  if (problemFound) {
    useSonner.error(problemText(problemFound, "Your review wasn't deleted. Check your connection and try again."));
    return;
  }
  useSonner.success("Your review is deleted.");
  rating.value = null;
  body.value = "";
  await refresh();
}

// ---------------------------------------------------------------------------
// The provider: one public reply
// ---------------------------------------------------------------------------
const replying = ref(false);
const replyBody = ref("");
const replyError = ref("");
function startReply() {
  replyBody.value = state.value?.reply?.status === "published" ? state.value.reply.body : "";
  replyError.value = "";
  replying.value = true;
  void nextTick(() => document.getElementById("reply-body")?.focus());
}
async function saveReply() {
  replyError.value = "";
  const parsed = replySchema.safeParse({ body: replyBody.value });
  if (!parsed.success) {
    replyError.value = parsed.error.issues[0]?.message ?? "Check your reply.";
    return;
  }
  const reviewId = state.value?.review?.id;
  if (!reviewId) return;
  busy.value = true;
  const result = state.value?.reply
    ? await supabase.from("review_replies").update({ body: parsed.data.body }).eq("review_id", reviewId).select("review_id")
    // Cast: provider_id is filled from the review by the trigger.
    : await supabase.from("review_replies").insert({ review_id: reviewId, body: parsed.data.body } as never).select("review_id");
  busy.value = false;
  const problemFound = changedRows(result, "saved");
  if (problemFound) {
    replyError.value = problemText(problemFound, reviewProblem(result.error, "reply"));
    return;
  }
  useSonner.success("Your reply is up.");
  replying.value = false;
  await refresh();
}
const deleteReplyOpen = ref(false);
async function deleteReply() {
  const reviewId = state.value?.review?.id;
  if (!reviewId) return;
  busy.value = true;
  const result = await supabase.from("review_replies").delete().eq("review_id", reviewId).select("review_id");
  busy.value = false;
  deleteReplyOpen.value = false;
  const problemFound = changedRows(result, "deleted");
  if (problemFound) {
    useSonner.error(problemText(problemFound, "Your reply wasn't deleted. Check your connection and try again."));
    return;
  }
  useSonner.success("Your reply is deleted.");
  await refresh();
}
</script>

<template>
  <section v-if="state && (state.review || state.can_write || why)" id="review" aria-labelledby="review-heading"
    class="border-border mt-8 scroll-mt-20 border-t pt-6">
    <h2 id="review-heading" tabindex="-1" class="text-lg font-semibold outline-none">
      {{ state.role === "customer" ? "Your review" : "The customer's review" }}
    </h2>

    <!-- The form: a first review, or an edit. -->
    <form v-if="showForm" class="mt-4 space-y-4" novalidate @submit.prevent="save">
      <StarRatingInput id="review-rating" v-model="rating" />
      <div class="space-y-2">
        <UiLabel for="review-body">Tell others about it</UiLabel>
        <p id="review-body-hint" class="text-muted-foreground text-sm">What was it like? What should others know before booking?</p>
        <UiTextarea id="review-body" v-model="body" :rows="5" :maxlength="REVIEW_MAX" aria-describedby="review-body-hint review-body-count" />
        <p id="review-body-count" class="text-muted-foreground text-right text-xs">{{ body.trim().length }} of 2,000 characters (at least 20)</p>
      </div>
      <p v-if="error" role="alert" class="text-destructive text-sm">{{ error }}</p>
      <p class="text-sm">
        Your review will show as <strong>{{ state.reviewer_name }}</strong>. You can edit or delete it until {{ until }}.
        <NuxtLink to="/review-rules" class="font-medium">Our review rules</NuxtLink>
      </p>
      <div class="flex flex-wrap gap-3">
        <UiButton type="submit" :disabled="busy">{{ busy ? "Posting…" : editing ? "Save changes" : "Post review" }}</UiButton>
        <UiButton v-if="editing" type="button" variant="outline" @click="editing = false">Cancel</UiButton>
      </div>
    </form>

    <!-- The review itself. -->
    <template v-else-if="state.review">
      <div v-if="state.review.status === 'removed'" class="mt-3 text-sm">
        <p>
          lokl removed {{ state.role === "customer" ? "your" : "this" }} review because it {{ ruleTitle(state.review.removed_rule) }}.
          <NuxtLink to="/review-rules" class="font-medium">Our review rules</NuxtLink>
        </p>
      </div>
      <div v-else class="mt-3 space-y-2">
        <ReviewStars :value="state.review.rating" :spoken="reviewStarsSpoken(state.review.rating)" />
        <p class="leading-relaxed whitespace-pre-line">{{ state.review.body }}</p>
        <p class="text-muted-foreground text-sm">
          {{ state.reviewer_name }} · {{ formatSessionDate(state.review.created_at, timezone) }}<template v-if="state.review.edited_at"> · Edited</template>
          <template v-if="listingPath"> · <NuxtLink :to="`${listingPath}#reviews`" class="font-medium">See it on the listing</NuxtLink></template>
        </p>
        <div v-if="state.review.can_change" class="flex flex-wrap gap-3 pt-1">
          <UiButton variant="outline" size="sm" class="min-h-11" @click="startEdit">Edit</UiButton>
          <UiButton variant="outline" size="sm" class="min-h-11" @click="deleteOpen = true">Delete</UiButton>
          <p class="text-muted-foreground self-center text-sm">You can change it until {{ until }}.</p>
        </div>
      </div>

      <!-- The reply. -->
      <div v-if="state.reply && state.reply.status === 'published' && !replying" class="border-border mt-4 ml-4 space-y-1 border-l-2 pl-4">
        <p class="text-sm font-medium">Reply from {{ providerName }}<span v-if="state.reply.edited_at" class="text-muted-foreground font-normal"> · Edited</span></p>
        <p class="text-sm leading-relaxed whitespace-pre-line">{{ state.reply.body }}</p>
      </div>
      <template v-if="state.role === 'provider' && state.review.status === 'published'">
        <p v-if="state.reply?.status === 'removed'" class="mt-4 text-sm">
          lokl removed your reply because it {{ ruleTitle(state.reply.removed_rule) }}. Delete it to write a new one.
        </p>
        <form v-if="replying" class="mt-4 space-y-3" novalidate @submit.prevent="saveReply">
          <UiLabel for="reply-body">Your public reply</UiLabel>
          <p id="reply-body-hint" class="text-muted-foreground text-sm">
            Keep it about the booking. Don't share the customer's details, or offer anything in return for changing the review.
          </p>
          <UiTextarea id="reply-body" v-model="replyBody" :rows="4" :maxlength="REPLY_MAX" aria-describedby="reply-body-hint" />
          <p v-if="replyError" role="alert" class="text-destructive text-sm">{{ replyError }}</p>
          <div class="flex flex-wrap gap-3">
            <UiButton type="submit" :disabled="busy">{{ busy ? "Posting…" : state.reply ? "Save reply" : "Post reply" }}</UiButton>
            <UiButton type="button" variant="outline" @click="replying = false">Cancel</UiButton>
          </div>
        </form>
        <div v-else class="mt-4 flex flex-wrap gap-3">
          <UiButton v-if="!state.reply" variant="outline" size="sm" class="min-h-11" @click="startReply">Reply</UiButton>
          <UiButton v-else-if="state.reply.status === 'published'" variant="outline" size="sm" class="min-h-11" @click="startReply">Edit reply</UiButton>
          <UiButton v-if="state.reply" variant="outline" size="sm" class="min-h-11" @click="deleteReplyOpen = true">Delete reply</UiButton>
        </div>
      </template>
    </template>

    <p v-else-if="why" class="text-muted-foreground mt-3 text-sm">{{ why }}</p>

    <UiAlertDialog v-model:open="deleteOpen" title="Delete your review?"
      :description="`You can write a new one until ${until}.`">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiButton variant="destructive" :disabled="busy" @click="deleteReview">Delete review</UiButton>
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
    <UiAlertDialog v-model:open="deleteReplyOpen" title="Delete your reply?" description="You can write a new one afterwards.">
      <template #footer>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel text="Keep it" />
          <UiButton variant="destructive" :disabled="busy" @click="deleteReply">Delete reply</UiButton>
        </UiAlertDialogFooter>
      </template>
    </UiAlertDialog>
  </section>
</template>
