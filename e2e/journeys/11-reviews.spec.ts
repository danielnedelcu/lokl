import type { Page } from "@playwright/test";
import { signIn } from "../support/auth";
import type { TestData } from "../support/data";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";
import { signInEmail, typeCode } from "../support/mail";

// Journey 11: reviews and star ratings (docs/design/reviews.md).

async function setup(data: TestData, label: string) {
  const owner = await data.user(`${label}-owner`);
  const name = `E2E ${label} ${data.run}`;
  const providerId = await data.provider(owner, name);
  const listing = await data.listing(providerId, "experience", (await data.category("experience")).id, await data.area());
  const { data: row } = await data.env.db.from("providers").select("slug").eq("id", providerId).single();
  return { owner, providerId, name, listing, slug: (row as { slug: string }).slug };
}

const reviewRow = (data: TestData, bookingId: string) =>
  data.env.db.from("reviews").select("id, rating, body, status").eq("booking_id", bookingId).maybeSingle().then((r) => r.data);

/** The listing page's Reviews section. */
const reviewsSection = (page: Page) => page.getByRole("region", { name: /^Reviews/ });

test("a customer reviews a completed booking with the keyboard; it's on the listing at once; they edit and delete it", async ({ page, context, data }) => {
  test.setTimeout(120_000);
  const p = await setup(data, "Rev");
  const customer = await data.user("reviewer");
  const bookingId = await data.completedBooking(customer, p.listing.id, { name: "sam CUSTOMER" });

  // Completing the booking queued the request email, linking to the review form.
  const { data: emails } = await data.env.db.from("booking_emails").select("kind").eq("booking_id", bookingId);
  expect((emails ?? []).map((e) => e.kind)).toContain("customer_review_request");

  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${bookingId}#review`);
  const section = page.getByRole("region", { name: "Your review" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("Your review will show as Sam C.");

  // The stars: a radio group, moved with the arrow keys, each named in words.
  const group = section.getByRole("radiogroup", { name: "Your rating" });
  await expect(group.getByRole("radio")).toHaveCount(5);
  await expect(group.getByRole("radio", { name: "5 stars: Excellent" })).toBeVisible();
  // Instant presses, as voice control and switch devices send them: each
  // arrow key selects the star it moves to (UiRadioGroup's lokl change).
  await group.getByRole("radio", { name: "1 star: Poor" }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "4 stars: Very good" })).toBeChecked();
  await expect(section.getByText("4 stars: Very good", { exact: true })).toBeVisible();

  // Contact details are refused, with what they look like.
  const text = section.getByLabel("Tell others about it");
  await text.fill("A great walk. Call the guide on 404 555 0123 to book again.");
  await section.getByRole("button", { name: "Post review" }).click();
  await expect(section.getByRole("alert")).toContainText("looks like a phone number");

  await text.fill("A great walk through the neighbourhood, with plenty of food.");
  await section.getByRole("button", { name: "Post review" }).click();
  await expect(page.getByText("Thanks. Your review is up.")).toBeVisible();
  await expect(section).toContainText("A great walk through the neighbourhood");
  expect(await reviewRow(data, bookingId)).toMatchObject({ rating: 4, status: "published" });

  // On the listing page at once (not cached).
  await page.goto(`/experiences/${p.listing.slug}`);
  const reviews = reviewsSection(page);
  await expect(reviews.getByRole("article", { name: "Review by Sam C." })).toContainText("A great walk through the neighbourhood");
  await expect(reviews.getByRole("article", { name: "Review by Sam C." })).toContainText("4 out of 5 stars");
  await expect(page.getByText("New on lokl, 1 review").first()).toBeAttached();

  // Edit: five stars, new words; marked edited.
  await page.goto(`/account/bookings/${bookingId}#review`);
  await section.getByRole("button", { name: "Edit" }).click();
  await group.getByRole("radio", { name: "5 stars: Excellent" }).click();
  await text.fill("Even better on reflection: a great walk with plenty of food.");
  await section.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your review is updated.")).toBeVisible();
  await page.goto(`/experiences/${p.listing.slug}`);
  await expect(reviewsSection(page).getByRole("article", { name: "Review by Sam C." })).toContainText("Edited");

  // Delete it, and the form is back.
  await page.goto(`/account/bookings/${bookingId}#review`);
  await section.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete review" }).click();
  await expect(page.getByText("Your review is deleted.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Post review" })).toBeVisible();
  expect(await reviewRow(data, bookingId)).toBeNull();
});

test("the rating line and breakdown: none, two reviews, then three", async ({ page, data }) => {
  const p = await setup(data, "Rate");
  const c = await data.user("rater");
  const listingPath = `/experiences/${p.listing.slug}`;

  await page.goto(listingPath);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(reviewsSection(page)).toContainText("New on lokl. No reviews yet.");

  await data.review(await data.completedBooking(c, p.listing.id, { name: "Ann Lee" }), 5, "Lovely from start to finish, would book again.");
  await data.review(await data.completedBooking(c, p.listing.id, { name: "Bo Diaz" }), 5, "A great guide and plenty to eat along the way.");
  await page.goto(listingPath);
  await expect(page.getByText("New on lokl, 2 reviews").first()).toBeAttached();
  await expect(reviewsSection(page).getByRole("list", { name: "Reviews by stars" })).toHaveCount(0);
  await expect(reviewsSection(page).getByRole("article")).toHaveCount(2);

  await data.review(await data.completedBooking(c, p.listing.id, { name: "Cy Ng" }), 4, "Good walk, a little long in the heat of the day.");
  await page.goto(listingPath);
  // 5, 5, 4: 4.67 → 4.7. The line under the title, and the breakdown as text.
  await expect(page.getByText("Rated 4.7 out of 5 from 3 reviews").first()).toBeAttached();
  const breakdown = reviewsSection(page).getByRole("list", { name: "Reviews by stars" });
  await expect(breakdown.getByRole("listitem")).toHaveCount(5);
  await expect(breakdown).toContainText("5 stars: 2 reviews, 67%");
  await expect(breakdown).toContainText("4 stars: 1 review, 33%");
  await expect(breakdown).toContainText("1 star: 0 reviews, 0%");
  // The provider's combined rating in the profile card, and on the profile page.
  await expect(page.getByRole("region", { name: "Hosted by" })).toContainText("Rated 4.7 out of 5 from 3 reviews");
  await page.goto(`/providers/${p.slug}`);
  await expect(page.getByText("Rated 4.7 out of 5 from 3 reviews").first()).toBeAttached();
  // The listing card: "★ 4.7 (3)".
  const card = page.getByRole("region", { name: /^Experiences/ }).getByRole("link", { name: new RegExp(p.listing.title) });
  await expect(card).toContainText("4.7 (3)");
  await expect(card).toContainText("Rated 4.7 out of 5 from 3 reviews");
});

test("the provider replies to a review, and edits the reply", async ({ page, context, data }) => {
  const p = await setup(data, "Reply");
  const c = await data.user("replied-to");
  const bookingId = await data.completedBooking(c, p.listing.id, { name: "Dee Fox" });
  await data.review(bookingId, 3, "Fine, but the second stop was closed when we got there.");
  const { data: notes } = await data.env.db.from("notifications").select("kind").eq("booking_id", bookingId);
  expect((notes ?? []).map((n) => n.kind), "the provider's bell rang").toContain("review_posted");

  await signIn(context, p.owner.email, p.owner.password);
  await page.goto("/dashboard/reviews");
  await page.getByRole("link", { name: "Reply to Dee F.'s review" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/bookings/${bookingId}#review$`));
  const section = page.getByRole("region", { name: "The customer's review" });
  await section.getByRole("button", { name: "Reply" }).click();
  await section.getByLabel("Your public reply").fill("Sorry about the closed stop. We've changed the route since.");
  await section.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByText("Your reply is up.")).toBeVisible();

  await section.getByRole("button", { name: "Edit reply" }).click();
  await section.getByLabel("Your public reply").fill("Sorry about the closed stop, Dee. We've changed the route since.");
  await section.getByRole("button", { name: "Save reply" }).click();
  await expect(page.getByText("Your reply is up.")).toBeVisible();

  await page.goto(`/experiences/${p.listing.slug}`);
  const review = reviewsSection(page).getByRole("article", { name: "Review by Dee F." });
  await expect(review).toContainText(`Reply from ${p.name}`);
  await expect(review).toContainText("Sorry about the closed stop, Dee.");
  await expect(review).toContainText("Edited");
});

test("a visitor reports a review after signing in; the admin removes it under a rule; another report is kept", async ({ page, context, data }) => {
  test.setTimeout(150_000);
  const p = await setup(data, "Mod");
  const customer = await data.user("moderated");
  const bookingId = await data.completedBooking(customer, p.listing.id, { name: "Eli Gray" });
  const reviewId = await data.review(bookingId, 1, "The guide was rude to everyone and the food was cold.");
  const keptBooking = await data.completedBooking(customer, p.listing.id, { name: "Eli Gray" });
  const keptId = await data.review(keptBooking, 2, "Not for us: too much walking and not enough tasting.");
  const visitor = await data.user("reporter");
  const admin = await data.user("admin", { admin: true });

  // Signed out: Report asks to sign in first, then carries on to the report.
  await page.goto(`/experiences/${p.listing.slug}`);
  await reviewsSection(page).getByRole("article").filter({ hasText: "The guide was rude to everyone" })
    .getByRole("button", { name: "Report Eli G.'s review" }).click();
  const signInDialog = page.getByRole("dialog", { name: "Sign in to report a review" });
  await signInDialog.getByLabel("Email").fill(visitor.email);
  await signInDialog.getByRole("button", { name: "Send me a code" }).click();
  await typeCode(page, signInDialog, (await signInEmail(data.env.mailpitUrl, visitor.email)).code);
  await signInDialog.getByRole("button", { name: "Sign in" }).click();
  const report = page.getByRole("dialog", { name: /^Report Eli G\.'s review/ });
  await expect(report).toBeVisible();
  // An instant arrow press selects the reason it moves to (plain UiRadioGroup, too).
  await report.getByRole("radio", { name: /Is abusive/ }).click();
  await page.keyboard.press("ArrowDown");
  await expect(report.getByRole("radio", { name: /Shares private information/ })).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(report.getByRole("radio", { name: /Is abusive/ })).toBeChecked();
  await report.getByLabel("Anything we should know? (optional)").fill("Insults aimed at the guide.");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. We'll look at it against our review rules.")).toBeVisible();
  // The review stays up while it's looked at.
  await expect(reviewsSection(page).getByText("The guide was rude to everyone")).toBeVisible();
  // A second report, on the other review (made directly).
  const { error: reportError } = await data.env.db.from("review_reports").insert({ review_id: keptId, rule: "off_topic", reporter_id: visitor.id } as never);
  expect(reportError).toBeNull();

  // The admin: remove the first under its rule, keep the second.
  await context.clearCookies();
  await signIn(context, admin.email, admin.password);
  await page.goto(`${ADMIN}/content/reviews`);
  const removeCard = page.getByRole("listitem").filter({ hasText: "The guide was rude to everyone" });
  await removeCard.getByRole("button", { name: "Remove review" }).click();
  const act = page.getByRole("dialog", { name: "Remove Eli G.'s review?" });
  await expect(act.getByRole("radio", { name: /Is abusive/ })).toBeChecked();
  await act.getByLabel("Reason (only admins see it)").fill("Insults aimed at a named guide.");
  await act.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Removed, and the author emailed.")).toBeVisible();
  const keepCard = page.getByRole("listitem").filter({ hasText: "too much walking" });
  await keepCard.getByRole("button", { name: "Keep review" }).click();
  const keep = page.getByRole("dialog", { name: "Keep Eli G.'s review?" });
  await keep.getByLabel("Reason (only admins see it)").fill("An honest negative review, on topic.");
  await keep.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByText("Kept. The reports are dismissed.")).toBeVisible();

  // Recorded: removed with the rule, logged, the customer emailed; the other kept.
  expect(await reviewRow(data, bookingId)).toMatchObject({ status: "removed" });
  const { data: log } = await data.env.db.from("admin_actions").select("action, rule").eq("target", "review").eq("target_id", reviewId);
  expect(log).toEqual([{ action: "remove_review", rule: "abuse" }]);
  const { data: queued } = await data.env.db.from("booking_emails").select("kind").eq("booking_id", bookingId).eq("kind", "customer_review_removed");
  expect(queued).toHaveLength(1);
  const { data: kept } = await data.env.db.from("review_reports").select("status").eq("review_id", keptId);
  expect(kept).toEqual([{ status: "dismissed" }]);

  // Gone from the listing and its count; the kept one stays.
  await context.clearCookies();
  await page.goto(`/experiences/${p.listing.slug}`);
  await expect(reviewsSection(page).getByText("The guide was rude to everyone")).toHaveCount(0);
  await expect(reviewsSection(page).getByText("too much walking")).toBeVisible();
  await expect(page.getByText("New on lokl, 1 review").first()).toBeAttached();

  // The customer sees why.
  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${bookingId}#review`);
  await expect(page.getByRole("region", { name: "Your review" })).toContainText("lokl removed your review because it is abusive");
});

test("outside the 14 days, there's no form, and the page says why", async ({ page, context, data }) => {
  const p = await setup(data, "Late");
  const c = await data.user("late");
  const bookingId = await data.completedBooking(c, p.listing.id, { endedDaysAgo: 20 });
  await signIn(context, c.email, c.password);
  await page.goto(`/account/bookings/${bookingId}`);
  const section = page.getByRole("region", { name: "Your review" });
  await expect(section).toContainText("Reviews closed on");
  await expect(section.getByRole("button", { name: "Post review" })).toHaveCount(0);
});
