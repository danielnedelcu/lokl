import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";

// Journey 29: problem reports (docs/design/problem-reports.md). Built in
// phases; for now the provider's bell: a reply from lokl to a report (which
// has no listing) shows by the report's category and leads to the report.

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
