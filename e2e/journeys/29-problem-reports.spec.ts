import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 29: problem reports (docs/design/problem-reports.md). Built in
// phases. The provider's side: reporting a Safety problem by keyboard with
// the 911 line in view, the statuses in words, lokl's reply appearing on
// the open report without a reload, replying, "This is sorted", and the
// Help count. The bell: a reply from lokl to a report (which has no
// listing) shows by the report's category and leads to the report. The
// admin's side: the board ("Move to…" by keyboard, announced, focus kept;
// dragging; search; "Show more"), the report page ("Reply and wait",
// private notes, the history), the admin bell and the dashboard count;
// and with the report open on both sides, each reply appears on the other
// side without a reload, while no Realtime frame carries its words.

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
  const item = page.getByRole("list", { name: "Notifications, newest first" }).getByRole("button", { name: /lokl replied to your report about payments and payouts\./ });
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
  await expect(page.getByRole("radio", { name: "Safety" })).toBeFocused();
  // Space chooses the focused option (arrows usually do too, but not always at once).
  await page.keyboard.press("Space");
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

/** Every Realtime frame a page receives, to check no reply's words go through it. */
function realtimeFrames(page: Page) {
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/realtime/")) return;
    ws.on("framereceived", (f) => frames.push(typeof f.payload === "string" ? f.payload : f.payload.toString()));
  });
  return frames;
}

async function adminContext(context: BrowserContext, admin: { email: string; password: string }) {
  const ctx = await context.browser()!.newContext();
  await signIn(ctx, admin.email, admin.password, { app: "admin" });
  return ctx;
}

test("with a report open on both sides, each reply appears on the other side without a reload, and no Realtime frame carries it", async ({ page, context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner);
  const { data: report, error } = await data.env.db.from("support_reports")
    .insert({ provider_id: provider, category: "payments", description: "My payout for last week hasn't arrived." }).select("id").single();
  if (error) throw new Error(error.message);

  // The provider, on their report.
  await signIn(context, owner.email, owner.password);
  const providerFrames = realtimeFrames(page);
  await page.goto(`/dashboard/help/${report.id}`);
  const providerThread = page.getByRole("list", { name: "Messages, oldest first" });
  await expect(page.getByText("Received", { exact: true })).toBeVisible();

  // lokl, on the same report, in another browser.
  const ctx = await adminContext(context, admin);
  const adminPage = await ctx.newPage();
  const adminFrames = realtimeFrames(adminPage);
  await adminPage.goto(`${ADMIN}/reports/${report.id}`);
  const adminThread = adminPage.getByRole("list", { name: "Messages, oldest first" });
  await expect(adminThread.getByText("My payout for last week hasn't arrived.")).toBeVisible();
  // Both live feeds joined before anyone writes (Realtime doesn't replay).
  await expect.poll(() => providerFrames.some((f) => f.includes('"status":"ok"') && f.includes("postgres_changes")), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => adminFrames.some((f) => f.includes('"status":"ok"') && f.includes("postgres_changes")), { timeout: 15_000 }).toBe(true);

  // lokl replies and waits: the provider's page shows it, and the status.
  const lokl = "Which bank account did you set up for payouts?";
  await adminPage.getByLabel("Reply to the provider").fill(lokl);
  await adminPage.getByRole("button", { name: "Reply and wait for their answer" }).click();
  await expect(adminThread.getByText(lokl)).toBeVisible();
  await expect(adminPage.getByText("Waiting on provider", { exact: true })).toBeVisible();
  await expect(providerThread.getByText(lokl)).toBeVisible();
  await expect(page.getByText("Waiting for your reply", { exact: true })).toBeVisible();

  // The provider answers: lokl's page shows it.
  const answer = "The one ending 6789, set up last month.";
  await page.getByRole("textbox", { name: "Your reply" }).fill(answer);
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(adminThread.getByText(answer)).toBeVisible();
  await expect(adminPage.getByText("In progress", { exact: true })).toBeVisible();

  // Neither reply went through Realtime: only ids did.
  for (const words of [lokl, answer, "hasn't arrived"]) {
    expect(providerFrames.some((f) => f.includes(words)), `no frame on the provider's side has "${words}"`).toBe(false);
    expect(adminFrames.some((f) => f.includes(words)), `no frame on lokl's side has "${words}"`).toBe(false);
  }

  // A private note: on lokl's page, never on the provider's.
  await adminPage.getByLabel("Add a note").fill("Called Stripe: the payout is in transit.");
  await adminPage.getByRole("button", { name: "Add note" }).click();
  await expect(adminPage.getByText("Called Stripe: the payout is in transit.")).toBeVisible();
  await expect(adminPage.getByText("Only lokl sees these.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Called Stripe")).toHaveCount(0);

  // The history names who moved it.
  await expect(adminPage.getByRole("region", { name: "History" }).getByText("lokl moved it to Waiting on provider")).toBeVisible();
  await expect(adminPage.getByRole("region", { name: "History" }).getByText("The provider moved it to In progress")).toBeVisible();
  await ctx.close();
});

test("the board: Safety first, \"Move to…\" by keyboard (announced, focus kept), dragging, search, the bell and the dashboard count", async ({ context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner, `Board Studio ${data.run}`);
  const insert = async (category: string, description: string) => {
    const { data: r, error } = await data.env.db.from("support_reports").insert({ provider_id: provider, category, description }).select("id").single();
    if (error) throw new Error(error.message);
    return r.id as string;
  };
  await insert("website", `The calendar shows the wrong week ${data.run}.`);
  const safety = await insert("safety", `A customer would not leave my studio ${data.run}.`);
  const percent = await insert("payments", `I was charged 100% of the fee twice ${data.run}.`);

  const ctx = await adminContext(context, admin);
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/reports?q=${encodeURIComponent(`Board Studio ${data.run}`)}`);
  const todo = page.getByRole("region", { name: /^To do/ });
  const inProgress = page.getByRole("region", { name: /^In progress/ });
  await expect(page.getByRole("heading", { name: "To do, 3 reports" })).toBeVisible();
  // Safety first, marked Urgent in words.
  const firstCard = todo.locator("[data-card]").first();
  await expect(firstCard).toHaveAttribute("data-card", safety);
  await expect(firstCard.getByText("Urgent")).toBeVisible();

  // "Move to…" by keyboard only.
  const move = firstCard.getByRole("button", { name: /^Move to…/ });
  await move.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "In progress" }).focus();
  await page.keyboard.press("Enter");
  await expect(inProgress.locator(`[data-card="${safety}"]`)).toBeVisible();
  await expect(page.locator("[aria-live=polite]").filter({ hasText: /Moved "Safety from Board Studio .*" to In progress\./ })).toHaveCount(1);
  await expect(inProgress.locator(`[data-card="${safety}"]`)).toBeFocused();
  await expect(page.getByRole("heading", { name: "In progress, 1 report" })).toBeVisible();

  // Dragging does the same.
  await todo.locator(`[data-card="${percent}"]`).dragTo(page.getByRole("region", { name: /^Done/ }));
  await expect(page.getByRole("region", { name: /^Done/ }).locator(`[data-card="${percent}"]`)).toBeVisible();
  await expect(page.locator("[aria-live=polite]").filter({ hasText: /to Done\./ })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("region", { name: /^Done/ }).locator(`[data-card="${percent}"]`)).toBeVisible();

  // Search: "%" matches only itself.
  await page.goto(`${ADMIN}/reports?q=${encodeURIComponent(`100% ${data.run}`)}`);
  await expect(page.getByRole("heading", { name: "Done, 1 report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "To do, 0 reports" })).toBeVisible();

  // The bell: the Safety report, urgent, leading to it.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const item = page.getByRole("list", { name: "Notifications, newest first" }).getByRole("button", { name: new RegExp(`Urgent: a safety report from Board Studio ${data.run}\\.`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(`${ADMIN}/reports/${safety}`);

  // The dashboard counts open reports and the urgent one.
  await page.goto(`${ADMIN}/`);
  await expect(page.getByRole("link", { name: /Open problem reports \(\d+ urgent\)/ })).toBeVisible();
  await ctx.close();
});

test("a board column shows its total and pages with \"Show more\", never stopping quietly", async ({ context, data }) => {
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner, `Many Studio ${data.run}`);
  // 55 reports waiting on the provider: more than one page of 50. Safety
  // ones, which the daily limit of 10 never refuses.
  const { data: made, error } = await data.env.db.from("support_reports")
    .insert(Array.from({ length: 55 }, (_, i) => ({ provider_id: provider, category: "safety", description: `Report number ${i + 1} for ${data.run}.` })))
    .select("id");
  if (error) throw new Error(error.message);
  const { error: moveError } = await data.env.db.from("support_reports").update({ status: "waiting" }).in("id", made.map((r) => r.id));
  if (moveError) throw new Error(moveError.message);
  const ctx = await adminContext(context, admin);
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/reports?q=${encodeURIComponent(`Many Studio ${data.run}`)}`);
  const waiting = page.getByRole("region", { name: /^Waiting on provider/ });
  await expect(page.getByRole("heading", { name: "Waiting on provider, 55 reports" })).toBeVisible();
  await expect(waiting.locator("[data-card]")).toHaveCount(50);
  await expect(waiting.getByText("Showing 50 of 55")).toBeVisible();
  await waiting.getByRole("button", { name: "Show more in Waiting on provider" }).click();
  await expect(waiting.locator("[data-card]")).toHaveCount(55);
  await expect(waiting.locator("[data-card]").nth(50)).toBeFocused();
  await expect(waiting.getByRole("button", { name: /Show more/ })).toHaveCount(0);
  await ctx.close();
});
