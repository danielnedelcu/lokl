import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 29: problem reports (docs/design/problem-reports.md). Built in
// phases. The provider's side: reporting a Safety problem by keyboard with
// the 911 line in view, the statuses in words, lokl's reply appearing on
// the open report without a reload, replying, "This is sorted", and the
// Help count. The bell: a reply from lokl to a report (which has no
// listing) shows by the report's category and leads to the report.

test("the bell shows lokl's reply to a problem report, and leads to it", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner);
  // A report, and lokl's reply (written as the server writes it).
  const { data: report, error } = await data.env.db.from("support_reports")
    .insert({ provider_id: provider, category: "payments", description: "My payout for last week hasn't arrived yet." }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: replyError } = await data.env.db.from("support_messages")
    .insert({ report_id: report.id, author_kind: "admin", author_id: admin.id, body: "Thanks: we're checking with Stripe." });
  if (replyError) throw new Error(replyError.message);

  await signIn(context, owner.email, owner.password);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
  const item = page.getByRole("menuitem", { name: /lokl replied to your report about payments and payouts\./ });
  await expect(item).toBeVisible();
  // The email-free bell never shows the message itself.
  await expect(page.getByText("we're checking with Stripe")).toHaveCount(0);
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/help/${report.id}$`));
});

test("a provider reports a Safety problem by keyboard, and lokl's reply appears without a reload", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  await data.provider(owner);
  await signIn(context, owner.email, owner.password);

  await page.goto("/dashboard/help");
  await expect(page.getByText("You haven't reported any problems.")).toBeVisible();
  await page.getByRole("link", { name: "Report a problem" }).click();
  await expect(page.getByRole("heading", { name: "Report a problem", level: 1 })).toBeVisible();
  // The 911 line, always, before anything is chosen (a notice with its own
  // heading; not role="alert", which would interrupt on arrival).
  await expect(page.getByRole("heading", { name: "If anyone is in danger, call 911 first" })).toBeVisible();

  // By keyboard only: the radio group's arrows, then Tab to what happened.
  await page.getByRole("radio", { name: "Bookings" }).focus();
  await page.keyboard.press("ArrowDown"); // Payments and payouts
  await page.keyboard.press("ArrowDown"); // My listing
  await page.keyboard.press("ArrowDown"); // The website
  await page.keyboard.press("ArrowDown"); // Safety
  await expect(page.getByRole("radio", { name: "Safety" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("What happened?")).toBeFocused();
  await page.keyboard.type("A customer shouted at me and wouldn't leave my studio.");
  await page.getByRole("button", { name: "Send report" }).focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/help\/[0-9a-f-]{36}$/);
  const reportId = page.url().split("/").pop()!;
  await expect(page.getByText("We've got your report and we've told the team now.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safety", level: 1 })).toBeVisible();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await expect(page.getByText("We've got your report and will look at it soon.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "If anyone is in danger, call 911 first" })).toBeVisible();
  // Only lokl closes a Safety report.
  await expect(page.getByRole("button", { name: "This is sorted" })).toHaveCount(0);

  // lokl replies and waits for an answer (as the server writes it): it
  // appears on the open page, with no reload, and the status says so.
  const { error } = await data.env.db.from("support_messages")
    .insert({ report_id: reportId, author_kind: "admin", author_id: admin.id, body: "Are you safe now? Which booking was it?" });
  if (error) throw new Error(error.message);
  await data.env.db.from("support_reports").update({ status: "waiting" }).eq("id", reportId);
  const thread = page.getByRole("list", { name: "Messages, oldest first" });
  await expect(thread.getByText("Are you safe now? Which booking was it?")).toBeVisible();
  await expect(thread.getByText(/^lokl/)).toBeVisible();

  // Waiting for their reply: the Help item counts it, in words for screen readers.
  await page.reload();
  await expect(page.getByText("Waiting for your reply", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation").first().getByRole("link", { name: /Help, 1 report waiting for your reply/ })).toBeVisible();

  await page.getByRole("textbox", { name: "Your reply" }).fill("Yes, I'm safe. It was the 10 AM booking today.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(thread.getByText("Yes, I'm safe. It was the 10 AM booking today.")).toBeVisible();
  await expect(page.getByText("We're looking into it", { exact: true })).toBeVisible();

  // The list shows it in words.
  await page.goto("/dashboard/help");
  const row = page.locator("[data-report]").filter({ hasText: "Safety" });
  await expect(row.getByText("We're looking into it")).toBeVisible();
});

test("a provider marks their report sorted, and a reply within 30 days reopens it", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const { data: report, error } = await data.env.db.from("support_reports")
    .insert({ provider_id: provider, category: "website", description: "The calendar page shows the wrong week for me." }).select("id").single();
  if (error) throw new Error(error.message);
  await signIn(context, owner.email, owner.password);

  await page.goto(`/dashboard/help/${report.id}`);
  await page.getByRole("button", { name: "This is sorted" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "This is sorted" })).toHaveCount(0);
  await expect(page.getByText("Replying reopens this report.")).toBeVisible();

  await page.getByRole("textbox", { name: "Your reply" }).fill("It's happening again this morning.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
});

test("a report resolved over 30 days ago offers a new report that follows on from it", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const { data: report, error } = await data.env.db.from("support_reports")
    .insert({ provider_id: provider, category: "payments", description: "A payout from September never arrived." }).select("id").single();
  if (error) throw new Error(error.message);
  data.resolvedDaysAgo(report.id, 40);
  await signIn(context, owner.email, owner.password);

  await page.goto(`/dashboard/help/${report.id}`);
  await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveCount(0);
  await page.getByRole("link", { name: "Start a new report about this" }).click();
  await expect(page.getByText(/This follows on from your report of/)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Payments and payouts" })).toBeChecked();
  await page.getByLabel("What happened?").fill("The same payout is still missing a month later.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("We've got your report. We'll reply here.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Your earlier report" })).toHaveAttribute("href", `/dashboard/help/${report.id}`);
});
