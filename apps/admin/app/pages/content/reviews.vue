<script setup lang="ts">
import { bookedLabel, REVIEW_RULES, REVIEW_RULE_KEYS, reviewStarsSpoken, type ReviewRule } from "@repo/types";

// Reviews (docs/design/reviews.md, Reporting and moderation): the queue of
// reviews with open reports, oldest report first, and all reviews with
// filters. Decisions are made against the written rules only: never for
// being negative, its stars, or the business disagreeing. Remove (naming
// the rule), keep (dismissing the reports) and restore all need a reason;
// the website does the change, the log and the author's email together.
useHead({ title: "Reviews · Admin" });
const supabase = useSupabaseClient();
const call = useWebsiteAdmin();
const websiteUrl = useRuntimeConfig().public.websiteUrl.replace(/\/$/, "");

interface Report { id: string; target: "review" | "reply"; rule: string; note: string | null; created_at: string; status: string; resolution_note: string | null; from: "provider" | "someone_else" }
interface Row {
  id: string; rating: number; body: string; reviewer_name: string; booking_month: string; created_at: string; edited_at: string | null;
  status: "published" | "removed"; removed_at: string | null; removed_rule: ReviewRule | null; removed_reason: string | null;
  listing: { id: string; title: string; slug: string; kind: string; status: string } | null;
  provider: { id: string; name: string; slug: string } | null;
  reply: { body: string; status: "published" | "removed"; removed_rule: ReviewRule | null; removed_reason: string | null } | null;
  reports: Report[];
  provider_removals: number;
  customer_removals: number;
}

const view = ref<"reported" | "all">("reported");
// "any": Reka's select can't use an empty value.
const status = ref<"any" | "published" | "removed">("any");
const stars = ref<string>("any");
const page = ref(1);
watch([view, status, stars], () => (page.value = 1));
const { data, error, pending, refresh } = await useAsyncData("admin-reviews", async () => {
  const { data: d, error: e } = await supabase.rpc("admin_reviews_page", {
    p_reported: view.value === "reported",
    p_status: status.value === "any" ? undefined : status.value,
    p_rating: stars.value === "any" ? undefined : Number(stars.value),
    p_page: page.value,
    p_page_size: 25,
  });
  if (e) throw e;
  return d as unknown as { total: number; open_reports: number; rows: Row[] };
}, { watch: [view, status, stars, page] });
watch(error, (e) => e && reportProblem("Couldn't load the reviews", e), { immediate: true });

const ruleTitle = (r: string | null) => (r && r in REVIEW_RULES ? REVIEW_RULES[r as ReviewRule].title : r === "something_else" ? "Something else" : "—");
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
const listingUrl = (l: Row["listing"]) => (l ? `${websiteUrl}/${l.kind === "experience" ? "experiences" : "services"}/${l.slug}` : null);
const openReports = (r: Row, target: "review" | "reply") => r.reports.filter((x) => x.status === "open" && x.target === target);

// One action dialog for every decision.
const acting = ref<{ row: Row; target: "review" | "reply"; action: "remove" | "restore" | "keep" } | null>(null);
const actionOpen = ref(false);
const rule = ref<ReviewRule | "">("");
const reason = ref("");
const busy = ref(false);
const formError = ref("");
function act(row: Row, target: "review" | "reply", action: "remove" | "restore" | "keep") {
  acting.value = { row, target, action };
  const reported = openReports(row, target)[0]?.rule;
  rule.value = action === "remove" && reported && reported in REVIEW_RULES ? (reported as ReviewRule) : "";
  reason.value = "";
  formError.value = "";
  actionOpen.value = true;
}
const actionTitle = computed(() => {
  const a = acting.value;
  if (!a) return "";
  const what = a.target === "review" ? `${a.row.reviewer_name}'s review` : `the reply to ${a.row.reviewer_name}'s review`;
  return a.action === "remove" ? `Remove ${what}?` : a.action === "restore" ? `Restore ${what}?` : `Keep ${what}?`;
});
const actionHelp = computed(() => {
  const a = acting.value;
  if (!a) return "";
  if (a.action === "remove") return a.target === "review"
    ? "It's hidden everywhere at once and drops out of the ratings. The customer is emailed the rule. They can't post it again."
    : "It's hidden at once. The provider is emailed the rule and can write a new reply.";
  if (a.action === "restore") return "It's public again, and counts again. Nobody is emailed.";
  return "The open reports are closed as dismissed. It stays up. The reporters aren't emailed.";
});
async function confirmAction() {
  const a = acting.value;
  if (!a) return;
  formError.value = "";
  if (a.action === "remove" && !rule.value) {
    formError.value = "Choose the rule it breaks.";
    return;
  }
  if (reason.value.trim().length < 5) {
    formError.value = "Give a reason (at least 5 characters). Only admins see it.";
    return;
  }
  busy.value = true;
  try {
    await call(`reviews/${a.row.id}/moderate`, { target: a.target, action: a.action, rule: a.action === "remove" ? rule.value : null, reason: reason.value.trim() });
    actionOpen.value = false;
    useSonner.success(a.action === "remove" ? "Removed, and the author emailed." : a.action === "restore" ? "Restored." : "Kept. The reports are dismissed.");
    await refresh();
  } catch (e) {
    formError.value = reportProblem((e as Error).message, e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader title="Reviews" description="Reported reviews and replies, judged against the written review rules. Never removed for being negative." />

    <div class="mb-4 flex flex-wrap items-end gap-4">
      <UiTabs v-model="view">
        <UiTabsList>
          <UiTabsTrigger value="reported">Reported<template v-if="data"> ({{ data.open_reports }})</template></UiTabsTrigger>
          <UiTabsTrigger value="all">All reviews</UiTabsTrigger>
        </UiTabsList>
      </UiTabs>
      <div class="space-y-1">
        <UiLabel for="review-status">Status</UiLabel>
        <UiSelect v-model="status">
          <UiSelectTrigger id="review-status" class="w-40"><UiSelectValue placeholder="Any" /></UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem value="any">Any</UiSelectItem>
            <UiSelectItem value="published">Published</UiSelectItem>
            <UiSelectItem value="removed">Removed</UiSelectItem>
          </UiSelectContent>
        </UiSelect>
      </div>
      <div class="space-y-1">
        <UiLabel for="review-stars">Stars</UiLabel>
        <UiSelect v-model="stars">
          <UiSelectTrigger id="review-stars" class="w-32"><UiSelectValue placeholder="Any" /></UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem value="any">Any</UiSelectItem>
            <UiSelectItem v-for="n in [5, 4, 3, 2, 1]" :key="n" :value="String(n)">{{ n }} {{ n === 1 ? "star" : "stars" }}</UiSelectItem>
          </UiSelectContent>
        </UiSelect>
      </div>
      <NuxtLink :to="`${websiteUrl}/review-rules`" target="_blank" class="text-sm font-medium">The review rules</NuxtLink>
    </div>

    <UiAlert v-if="error" variant="destructive" icon="lucide:alert-circle">
      <UiAlertTitle>The reviews didn't load</UiAlertTitle>
      <UiAlertDescription>{{ loadFailedHint }}</UiAlertDescription>
    </UiAlert>
    <p v-else-if="pending && !data" class="text-muted-foreground text-sm">Loading…</p>
    <EmptyState v-else-if="!data?.rows.length" icon="lucide:star"
      :title="view === 'reported' ? 'No reports to check' : 'No reviews match'"
      :description="view === 'reported' ? 'Reported reviews and replies show here, oldest report first.' : undefined" />
    <ul v-else class="space-y-4">
      <li v-for="r in data.rows" :key="r.id">
        <UiCard>
          <UiCardContent class="space-y-3 pt-6">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ReviewStars :value="r.rating" :spoken="reviewStarsSpoken(r.rating)" />
              <p class="font-medium">{{ r.reviewer_name }}</p>
              <p class="text-muted-foreground text-sm">
                {{ bookedLabel(r.booking_month) }} · posted {{ when(r.created_at) }}<template v-if="r.edited_at"> · edited</template>
              </p>
              <StatusBadge v-if="r.status === 'removed'" kind="review" status="removed" />
            </div>
            <p class="text-sm">
              <a v-if="listingUrl(r.listing)" :href="listingUrl(r.listing)!" target="_blank" class="font-medium">{{ r.listing?.title }}</a>
              <span v-else>{{ r.listing?.title }}</span>
              · {{ r.provider?.name }}
            </p>
            <p class="whitespace-pre-line">{{ r.body }}</p>
            <p v-if="r.status === 'removed'" class="text-sm">
              Removed {{ r.removed_at ? when(r.removed_at) : "" }}: {{ ruleTitle(r.removed_rule) }}. <span class="text-muted-foreground">“{{ r.removed_reason }}”</span>
            </p>

            <div v-if="r.reply" class="border-border ml-4 space-y-1 border-l-2 pl-4 text-sm">
              <p class="font-medium">Reply from {{ r.provider?.name }}<template v-if="r.reply.status === 'removed'"> (removed: {{ ruleTitle(r.reply.removed_rule) }})</template></p>
              <p class="whitespace-pre-line">{{ r.reply.body }}</p>
            </div>

            <div v-if="r.reports.length" class="bg-muted/50 space-y-2 rounded-md p-3 text-sm">
              <p class="font-medium">Reports</p>
              <ul class="space-y-1.5">
                <li v-for="rep in r.reports" :key="rep.id">
                  <span class="font-medium">{{ ruleTitle(rep.rule) }}</span>
                  on the {{ rep.target }}, {{ rep.from === "provider" ? "by the provider" : "by someone else" }}, {{ when(rep.created_at) }}
                  <span v-if="rep.status !== 'open'" class="text-muted-foreground">({{ rep.status }})</span>
                  <span v-if="rep.note" class="text-muted-foreground block">“{{ rep.note }}”</span>
                </li>
              </ul>
            </div>
            <p v-if="r.provider_removals || r.customer_removals" class="text-muted-foreground text-xs">
              Earlier removals: {{ r.provider_removals }} for this provider, {{ r.customer_removals }} for this customer.
            </p>

            <div class="flex flex-wrap gap-2 pt-1">
              <UiButton v-if="r.status === 'published'" size="sm" variant="destructive" @click="act(r, 'review', 'remove')">Remove review</UiButton>
              <UiButton v-else size="sm" variant="outline" @click="act(r, 'review', 'restore')">Restore review</UiButton>
              <UiButton v-if="openReports(r, 'review').length" size="sm" variant="outline" @click="act(r, 'review', 'keep')">Keep review</UiButton>
              <template v-if="r.reply">
                <UiButton v-if="r.reply.status === 'published'" size="sm" variant="outline" @click="act(r, 'reply', 'remove')">Remove reply</UiButton>
                <UiButton v-else size="sm" variant="outline" @click="act(r, 'reply', 'restore')">Restore reply</UiButton>
                <UiButton v-if="openReports(r, 'reply').length" size="sm" variant="outline" @click="act(r, 'reply', 'keep')">Keep reply</UiButton>
              </template>
            </div>
          </UiCardContent>
        </UiCard>
      </li>
    </ul>
    <div v-if="data && data.total > 25" class="mt-4 flex items-center gap-3 text-sm">
      <UiButton size="sm" variant="outline" :disabled="page === 1" @click="page--">Previous</UiButton>
      <span>Page {{ page }} of {{ Math.ceil(data.total / 25) }}</span>
      <UiButton size="sm" variant="outline" :disabled="page * 25 >= data.total" @click="page++">Next</UiButton>
    </div>

    <UiDialog v-model:open="actionOpen">
      <UiDialogContent class="sm:max-w-lg">
        <UiDialogHeader>
          <UiDialogTitle>{{ actionTitle }}</UiDialogTitle>
          <UiDialogDescription>{{ actionHelp }}</UiDialogDescription>
        </UiDialogHeader>
        <form class="space-y-4" novalidate @submit.prevent="confirmAction">
          <div v-if="acting?.action === 'remove'" class="space-y-2">
            <p id="moderate-rule-label" class="text-sm font-medium">Which rule does it break?</p>
            <UiRadioGroup v-model="rule" aria-labelledby="moderate-rule-label" class="gap-1">
              <label v-for="k in REVIEW_RULE_KEYS" :key="k" class="hover:bg-accent flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm">
                <UiRadioGroupItem :value="k" class="mt-0.5" />
                <span><span class="font-medium">{{ REVIEW_RULES[k].title }}</span><span class="text-muted-foreground block">{{ REVIEW_RULES[k].text }}</span></span>
              </label>
            </UiRadioGroup>
          </div>
          <div class="space-y-2">
            <UiLabel for="moderate-reason">Reason (only admins see it)</UiLabel>
            <UiTextarea id="moderate-reason" v-model="reason" :rows="3" :maxlength="1000" />
          </div>
          <p v-if="formError" role="alert" class="text-destructive text-sm">{{ formError }}</p>
          <UiDialogFooter>
            <UiButton type="button" variant="outline" @click="actionOpen = false">Cancel</UiButton>
            <UiButton type="submit" :variant="acting?.action === 'remove' ? 'destructive' : 'default'" :disabled="busy">
              {{ busy ? "Saving…" : acting?.action === "remove" ? "Remove" : acting?.action === "restore" ? "Restore" : "Keep it" }}
            </UiButton>
          </UiDialogFooter>
        </form>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
