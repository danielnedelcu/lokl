<script setup lang="ts">
import { REVIEW_RULES, REVIEW_RULE_KEYS } from "@repo/types";

// The written review rules (docs/design/reviews.md): linked from the review
// form, the reply box, the report dialog and the review emails. The list is
// REVIEW_RULES, the same one reports and removals use.
definePageMeta({ layout: "public" });
useSeoMeta({
  title: "Review rules",
  description: "How reviews work on lokl, and the only reasons a review or reply is removed.",
});
</script>

<template>
  <article class="mx-auto max-w-2xl px-4 py-8 leading-relaxed md:py-12">
    <h1 class="text-2xl font-semibold tracking-tight">Reviews on lokl</h1>
    <p class="mt-4">
      Reviews are from customers whose booking took place. Each booking can be reviewed once, within 14 days of
      its end. A review shows straight away.
    </p>

    <h2 class="mt-8 text-lg font-semibold">We remove a review or a reply only if it:</h2>
    <ol class="mt-3 list-decimal space-y-3 pl-6">
      <li v-for="k in REVIEW_RULE_KEYS" :key="k">
        <strong>{{ REVIEW_RULES[k].title }}.</strong> {{ REVIEW_RULES[k].text }}
      </li>
    </ol>

    <h2 class="mt-8 text-lg font-semibold">We never remove a review because it's negative</h2>
    <p class="mt-3">
      Not because of its stars, and not because the business disagrees with it. Businesses can reply publicly
      instead, once to each review.
    </p>

    <h2 class="mt-8 text-lg font-semibold">No rewards for reviews</h2>
    <p class="mt-3">
      lokl never offers anything for a review, and businesses on lokl must not either: no discounts, refunds,
      gifts or favours for writing, changing or removing one, and no asking only happy customers. If you're
      offered something, report the review or tell us.
    </p>

    <h2 class="mt-8 text-lg font-semibold">Reporting</h2>
    <p class="mt-3">
      Anyone signed in can report a review or a reply with the “Report” link under it. It stays up while we look
      at it against these rules. If we remove your review or reply, we email you which rule it broke.
    </p>
  </article>
</template>
