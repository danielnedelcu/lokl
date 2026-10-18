import { expect, test } from "../support/fixtures";

// Journey 37: the information pages and legal drafts (docs/design/
// website-pages.md, steps 3 and 4), the footer and the sign-in line.
// Each opens with its title and no fact left unfilled; the Fees page shows
// the commission rates from the database, so an admin's change shows at
// once; the support address is a link; links inside the pages lead
// somewhere; nothing scrolls sideways on a phone.

const PAGES: [string, string][] = [
  ["/about", "About lokl"],
  ["/how-lokl-works", "How lokl works"],
  ["/hosting", "How hosting works"],
  ["/fees", "Fees and payouts"],
  ["/contact", "Contact us"],
  ["/safety", "Safety on lokl"],
  ["/cancellation-policy", "Cancellation policy"],
  ["/accessibility", "Accessibility"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Use"],
  ["/terms/hosts", "Terms for hosts"],
];

test("every information page opens, with its facts filled in and its links working", async ({ page, request }) => {
  const checked = new Set<string>();
  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("article")).not.toContainText("{{");
    await expect(page.getByText(/^Last updated .+\d{4}\.$/)).toBeVisible();
    for (const href of await page.locator(".help-body a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      if (checked.has(href)) continue;
      checked.add(href);
      expect((await request.get(href, { maxRedirects: 0 })).status(), `${path} links to ${href}`).toBeLessThan(400);
    }
  }
});

test("the Fees page shows the commission rates from the database, and an admin's change at once", async ({ page, data }) => {
  await page.goto("/fees");
  const table = page.getByRole("region", { name: "Table" });
  await expect(table.getByRole("row", { name: /Services 12%/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Experiences 20%/ })).toBeVisible();
  const db = data.env.db;
  try {
    const { error } = await db.from("commission_rates").update({ rate_bps: 1250 }).eq("kind", "service");
    if (error) throw new Error(error.message);
    await page.reload();
    await expect(table.getByRole("row", { name: /Services 12.5%/ })).toBeVisible();
  } finally {
    await db.from("commission_rates").update({ rate_bps: 1200 }).eq("kind", "service");
  }
});

test("Contact, Safety and Accessibility give the support address as a link, and the 911 line", async ({ page }) => {
  for (const path of ["/contact", "/safety", "/accessibility"]) {
    await page.goto(path);
    await expect(page.locator(".help-body a[href^='mailto:']").first()).toHaveAttribute("href", /^mailto:.+@.+/);
  }
  for (const path of ["/contact", "/safety"]) {
    await page.goto(path);
    await expect(page.getByText("If anyone is in danger, call 911 first.")).toBeVisible();
  }
});

test("on a phone, no information page scrolls sideways @phone", async ({ page }) => {
  for (const [path] of PAGES) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path}: no sideways scroll`).toBe(true);
  }
});

test("the footer: four labelled columns, every link leading somewhere", async ({ page, request }) => {
  await page.goto("/about");
  const footer = page.locator("footer");
  for (const name of ["lokl", "Customers", "Hosts", "Support"]) await expect(footer.getByRole("navigation", { name })).toBeVisible();
  const hrefs = await footer.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs).toEqual(expect.arrayContaining(["/terms", "/privacy", "/help/hosts", "/review-rules"]));
  for (const href of hrefs) {
    // /dashboard asks a visitor to sign in first (a redirect), as it should.
    expect((await request.get(href, { maxRedirects: 0 })).status(), `the footer links to ${href}`).toBeLessThan(400);
  }
});

test("signing in says you're 18 or over and agree to the Terms and Privacy Policy, both opening in a new tab", async ({ page }) => {
  await page.goto("/login");
  const line = page.getByText("By continuing, you confirm you're 18 or over and agree to lokl's");
  await expect(line).toBeVisible();
  await expect(line.getByRole("link", { name: "Terms (opens in a new tab)" })).toHaveAttribute("href", "/terms");
  await expect(line.getByRole("link", { name: "Privacy Policy (opens in a new tab)" })).toHaveAttribute("href", "/privacy");
  await expect(line.getByRole("link", { name: /opens in a new tab/ }).first()).toHaveAttribute("target", "_blank");
});
