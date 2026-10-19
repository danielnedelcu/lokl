import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";
import { typeCode } from "../support/mail";
import { freshTotp } from "../support/totp";
import type { Page } from "@playwright/test";

// Journey 40: the owner's team (docs/design/admin-roles.md; step 5a). The
// owner invites someone on the Team page; they sign in, set up an
// authenticator and join, and the owner's bell says so. Removing someone
// ends their access at once, on a page they already have open. Support
// sees no owner pages, is turned away from them, and the server refuses
// support's guide changes as well.

/** Sets up an authenticator on /security, named "Phone". */
async function setUpPhone(page: Page) {
  await page.getByRole("button", { name: "Set up an authenticator" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.locator("#authenticator-key").innerText()).replace(/\s/g, "");
  await typeCode(page, page, await freshTotp(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Phone is set up.").first()).toBeVisible();
}

test("the owner invites someone, who sets up an authenticator and joins", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  await signIn(context, owner.email, owner.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/team`);
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  await expect(page.getByTestId(`member-${owner.email}`)).toContainText("(you)");

  // A reason is required.
  const joiner = `e2e-joiner-${data.run}@test.local`;
  await page.getByLabel("Email address").fill(joiner);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Say why, in a few words.")).toBeVisible();
  await page.getByLabel("Reason").fill("Help with problem reports");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.locator("form").getByText(`Invitation sent to ${joiner}. It lasts 7 days.`)).toBeVisible();
  const row = page.getByTestId(`member-${joiner}`);
  await expect(row).toContainText("Support");
  await expect(row).toContainText("Invited");
  await expect(row).toContainText("No authenticator yet");

  // The website made their login and queued the invitation (sent by Resend outside tests).
  const { data: member } = await data.env.db.from("admin_members").select("user_id, status").eq("status", "invited").eq("invited_by", owner.id).single();
  data.trackUser(member!.user_id);
  const { data: queued } = await data.env.db.from("admin_emails").select("kind").eq("recipient_id", member!.user_id);
  expect(queued?.map((e) => e.kind)).toEqual(["admin_invite"]);

  // They sign in (with a password set here, standing in for the emailed code;
  // journey 30 signs in with the code itself).
  const password = `e2e-${data.run}-joiner-password`;
  expect((await data.env.db.auth.admin.updateUserById(member!.user_id, { password })).error).toBeNull();
  const theirs = await browser.newContext();
  await signIn(theirs, joiner, password, { app: "admin" });
  const them = await theirs.newPage();
  await them.goto(`${ADMIN}/`);
  await expect(them).toHaveURL(/\/security\?setup=1$/);
  await setUpPhone(them);
  await them.getByRole("link", { name: "Continue to join the lokl admin team" }).click();
  await expect(them).toHaveURL(`${ADMIN}/join`);
  await expect(them.getByText("You've been invited as Support.")).toBeVisible();
  await them.getByRole("button", { name: "Join the team" }).click();
  await expect(them).toHaveURL(`${ADMIN}/`);
  // Support's menu: problem reports, not the owner's pages.
  await expect(them.getByRole("link", { name: "Problem reports" }).first()).toBeVisible();
  await expect(them.getByRole("link", { name: "Team" })).toHaveCount(0);
  await theirs.close();

  // The owner's page and bell.
  await page.reload();
  await expect(row).toContainText("Active");
  await expect(row).toContainText("1 authenticator");
  await page.getByRole("button", { name: /notifications/i }).click();
  await expect(page.getByRole("list", { name: "Notifications, newest first" })).toContainText(`${joiner} joined the team.`);
  await expect(page.getByRole("list", { name: "Notifications, newest first" })).toContainText(`You invited ${joiner} to the team as support.`);
});

test("removing someone ends their access at once", async ({ browser, context, data }) => {
  const owner = await data.user("owner", { admin: true });
  const member = await data.user("member", { admin: "support" });
  const theirs = await browser.newContext();
  await signIn(theirs, member.email, member.password, { app: "admin" });
  const them = await theirs.newPage();
  await them.goto(`${ADMIN}/reports`);
  await expect(them).toHaveURL(`${ADMIN}/reports`);

  await signIn(context, owner.email, owner.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/team`);
  // Not themselves: no actions on their own row.
  await expect(page.getByTestId(`member-${owner.email}`).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: `Remove ${member.email}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("They're signed out now and lose admin access at once.");
  await dialog.getByLabel("Reason").fill("Left the company");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`member-${member.email}`)).toHaveCount(0);
  await page.getByText("Removed (1)").click();
  await expect(page.getByRole("button", { name: `Invite again ${member.email}` })).toBeVisible();

  // Their open admin app: the next page is refused, with no sign-in left.
  await them.goto(`${ADMIN}/bookings`);
  await expect(them).toHaveURL(/\/login/);
  await theirs.close();
});

test("support sees no owner pages, and the server refuses support's guide changes", async ({ context, data }) => {
  const support = await data.user("support", { admin: "support" });
  const { id: guide } = await data.guide({ title: `E2E support guide ${data.run}` });
  await signIn(context, support.email, support.password, { app: "admin" });
  const page = await context.newPage();
  await page.goto(`${ADMIN}/`);
  for (const name of ["Team", "Settings", "Destination guides", "Homepage", "Categories", "Markets and areas"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "Reviews" }).first()).toBeVisible();

  for (const path of ["/team", "/content", `/content/${guide}`, "/content/homepage", "/settings"]) {
    await page.goto(`${ADMIN}${path}`);
    await expect(page).toHaveURL(`${ADMIN}/owner-only?page=${path}`);
    await expect(page.getByRole("heading", { level: 1, name: "Only the owner can open this page" })).toBeVisible();
  }

  // The admin app's server, asked directly.
  const res = await page.request.post(`${ADMIN}/api/guides/${guide}/publish`);
  expect(res.status()).toBe(403);
  expect(await res.text()).toContain("Only the owner can do this.");
});
