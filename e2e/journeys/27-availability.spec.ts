import { choose } from "../support/forms";
import type { Locator, Page } from "@playwright/test";
import { signIn } from "../support/auth";
import { expect, test } from "../support/fixtures";
import type { TestData } from "../support/data";

// Journey 27: the provider's Availability page and each Service's booking
// settings (docs/design/service-availability.md, phase 2). Weekly hours (an
// overlap refused, nothing half-saved; copy to every day), hours for a date,
// time off, booking settings, the preview of the times customers will see
// (Atlanta time, with the browser in Los Angeles) and why it's empty; the
// listing editor's mode (required, nothing preselected) and buffer, which can
// change while live; and phone width.

/** Chooses a time in one TimeInput, named by its label. */
async function setTime(page: Page, group: string, hour: string, minutes: string, half: "AM" | "PM", nth = 0) {
  const g = page.getByRole("group", { name: group }).nth(nth);
  // Each pick checked to have taken (choose; a busy runner once dropped one).
  for (const [label, value] of [["Hour", hour], ["Minutes", minutes], ["AM or PM", half]] as const) {
    await choose(page, g.getByLabel(label, { exact: true }), value);
  }
}
async function provider(data: TestData, page: Page, context: Parameters<typeof signIn>[0]) {
  const owner = await data.user("hours-owner");
  const id = await data.provider(owner, `E2E Hours ${data.run}`);
  await signIn(context, owner.email, owner.password);
  return id;
}
const rows = async (data: TestData, table: string, providerId: string) =>
  (await data.env.db.from(table).select("*").eq("provider_id", providerId)).data ?? [];
/** The next Monday at least two days ahead, in Atlanta, as YYYY-MM-DD. */
function nextMonday(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  for (let i = 2; i < 9; i++) {
    const c = new Date(d.getTime() + i * 864e5);
    if (c.getUTCDay() === 1) return c.toISOString().slice(0, 10);
  }
  throw new Error("no Monday");
}

test("weekly hours: open a day, an overlap refused (nothing saved), saved, copied to every day, a set removed", async ({ page, context, data }) => {
  test.setTimeout(150_000);
  const p = await provider(data, page, context);
  await page.goto("/dashboard/availability");
  await expect(page.getByRole("heading", { level: 1, name: "Availability" })).toBeVisible();
  await expect(page.getByText("All times are Atlanta time (ET).")).toBeVisible();
  await expect(page.getByRole("link", { name: "Availability" })).toHaveAttribute("aria-current", "page");

  // Monday, by keyboard: ticking it starts it at 9:00 AM to 5:00 PM.
  const monday = page.getByRole("checkbox", { name: "Open on Monday" });
  await monday.focus();
  await page.keyboard.press("Space");
  await expect(monday).toBeChecked();
  await expect(page.getByRole("group", { name: "From (Monday)" }).getByLabel("Hour", { exact: true })).toContainText("9");

  // A second set that overlaps: refused, with which hours it overlaps, and nothing saved.
  await page.getByRole("button", { name: "Add hours on Monday" }).click();
  await setTime(page, "From (Monday)", "4", "00", "PM", 1);
  await setTime(page, "To (Monday)", "6", "00", "PM", 1);
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(page.getByText("Overlaps 9:00 AM – 5:00 PM.")).toBeVisible();
  expect(await rows(data, "provider_weekly_hours", p)).toHaveLength(0);

  // 5:00 PM instead: they touch, which is fine.
  await setTime(page, "From (Monday)", "5", "00", "PM", 1);
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(page.getByText("Weekly hours saved.")).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_weekly_hours", p)).map((r) => `${r.weekday} ${r.starts}-${r.ends}`).sort())
    .toEqual(["1 09:00:00-17:00:00", "1 17:00:00-18:00:00"]);

  // Copy Monday to every day, then save: 7 days of two sets.
  await page.getByRole("button", { name: "Copy Monday's hours to every day" }).click();
  await expect(page.getByRole("checkbox", { name: "Open on Wednesday" })).toBeChecked();
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect.poll(async () => (await rows(data, "provider_weekly_hours", p)).length).toBe(14);

  // After a reload, as saved; then a set removed, by its name.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Open on Sunday" })).toBeChecked();
  await page.getByRole("button", { name: "Remove 5:00 PM – 6:00 PM on Sunday" }).click();
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect.poll(async () => (await rows(data, "provider_weekly_hours", p)).length).toBe(13);
});

test("ticking then unticking days, without choosing times: each simply closed, no errors, and it saves", async ({ page, context, data }) => {
  const p = await provider(data, page, context);
  await page.goto("/dashboard/availability");
  const form = page.getByRole("form", { name: "Weekly hours" });
  for (const day of ["Tuesday", "Wednesday", "Thursday", "Saturday"]) {
    const box = page.getByRole("checkbox", { name: `Open on ${day}` });
    await box.click();
    await expect(box).toBeChecked();
    await box.click();
    await expect(box).not.toBeChecked();
    // No error at all: no message, no red label, nothing marked invalid.
    await expect(form.getByText(/Invalid input|expected boolean|received undefined/i)).toHaveCount(0);
    await expect(form.locator("[aria-invalid=true]")).toHaveCount(0);
    await expect(form.locator(".text-destructive")).toHaveCount(0);
  }
  // A ticked day's hours appear; unticked, they're gone.
  await expect(page.getByRole("group", { name: "From (Tuesday)" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(page.getByText("Weekly hours saved.")).toBeVisible();
  await expect(form.locator("[aria-invalid=true]")).toHaveCount(0);
  expect(await rows(data, "provider_weekly_hours", p), "every day closed: no hours saved").toHaveLength(0);
});

test("unticking a day with hours: saved as closed; ticking it again brings its hours back", async ({ page, context, data }) => {
  const p = await provider(data, page, context);
  await page.goto("/dashboard/availability");
  const form = page.getByRole("form", { name: "Weekly hours" });
  // Monday, 10:00 AM to 2:00 PM, saved.
  await page.getByRole("checkbox", { name: "Open on Monday" }).click();
  await setTime(page, "From (Monday)", "10", "00", "AM");
  await setTime(page, "To (Monday)", "2", "00", "PM");
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(page.getByText("Weekly hours saved.")).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_weekly_hours", p)).length).toBe(1);

  // Unticked and saved: closed, nothing marked, no summary.
  await page.getByRole("checkbox", { name: "Open on Monday" }).click();
  await expect(page.getByRole("group", { name: "From (Monday)" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(page.getByText("Weekly hours saved.").last()).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_weekly_hours", p)).length, { message: "Monday's hours removed" }).toBe(0);
  await expect(form.getByText("Check the hours marked above.")).toHaveCount(0);
  await expect(form.locator("[aria-invalid=true]")).toHaveCount(0);

  // Ticked again: its hours come back as they were (not saved, until Save).
  await page.getByRole("checkbox", { name: "Open on Monday" }).click();
  await expect(page.getByRole("group", { name: "From (Monday)" }).getByLabel("Hour", { exact: true })).toContainText("10");
  await expect(page.getByRole("group", { name: "To (Monday)" }).getByLabel("Hour", { exact: true })).toContainText("2");
  await expect(page.getByRole("group", { name: "To (Monday)" }).getByLabel("AM or PM", { exact: true })).toContainText("PM");
  expect(await rows(data, "provider_weekly_hours", p), "not saved until Save").toHaveLength(0);
});

test("hours for a date, time off and booking settings", async ({ page, context, data }) => {
  test.setTimeout(150_000);
  const p = await provider(data, page, context);
  await page.goto("/dashboard/availability");

  // Hours for one date: 9:00 AM to 5:00 PM by default, then removed.
  const day = nextMonday();
  const [y, m, d] = day.split("-");
  await page.getByRole("group", { name: "Date" }).locator("[data-reka-date-field-segment]").first().click();
  await page.keyboard.type(`${m}${d}${y}`);
  await page.getByRole("button", { name: "Save hours for this date" }).click();
  await expect(page.getByText(/^Hours for .* saved\.$/)).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_date_hours", p)).map((r) => `${r.on_date} ${r.starts}-${r.ends}`))
    .toEqual([`${day} 09:00:00-17:00:00`]);
  const list = page.getByRole("list", { name: "Dates with their own hours" });
  await expect(list).toContainText("9:00 AM – 5:00 PM");
  await list.getByRole("button", { name: /^Remove the hours for / }).click();
  await expect(page.getByText(/is back to your weekly hours\.$/)).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_date_hours", p)).length).toBe(0);

  // Time off: two days, from the range picker.
  await page.getByRole("button", { name: /^Days off: / }).click();
  const cells = page.locator("[data-reka-calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])");
  await cells.nth(3).click();
  await cells.nth(4).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Note (optional, only you see it)").fill("Family visit");
  await page.getByRole("button", { name: "Add time off" }).click();
  await expect(page.getByText(/^Time off added: /)).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_time_off", p)).map((r) => r.note)).toEqual(["Family visit"]);
  await expect(page.getByRole("list", { name: "Time off" })).toContainText("Family visit");

  // Booking settings: the least notice, with the note about approval.
  await expect(page.getByText("Services you approve need at least 4 hours.", { exact: false })).toBeVisible();
  await choose(page, page.getByLabel("Least notice you need"), "2 hours");
  await page.getByRole("button", { name: "Save booking settings" }).click();
  await expect(page.getByText("Booking settings saved.")).toBeVisible();
  await expect.poll(async () => (await rows(data, "provider_schedules", p))[0]?.min_notice_minutes).toBe(120);
});

test("the preview: Atlanta times for a live Service, and why it's empty or not bookable yet", async ({ page, context, data }) => {
  test.setTimeout(150_000);
  const p = await provider(data, page, context);
  const area = await data.area();
  const cat = (await data.category("service")).id;
  const listing = await data.listing(p, "service", cat, area, `Preview cut ${data.run}`);
  await page.goto("/dashboard/availability");

  // No hours yet: it says so.
  const preview = page.getByRole("region", { name: "What customers will see" });
  await expect(preview.getByText("Set your hours first: customers can only book times you're open.")).toBeVisible();

  // Monday 9:00 AM to 11:00 AM: the next Monday's times, in Atlanta time though the browser is in Los Angeles.
  await data.env.db.from("provider_weekly_hours").insert({ provider_id: p, weekday: 1, starts: "09:00", ends: "11:00" });
  await page.reload();
  const monday = nextMonday();
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${monday}T12:00:00Z`));
  // The preview starts today (Atlanta): Monday is in its first or second week.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const weeksAhead = Math.floor((Date.parse(`${monday}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / (7 * 864e5));
  for (let i = 0; i < weeksAhead; i++) await preview.getByRole("button", { name: "Next week" }).click();
  const day = preview.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
  await expect(day).toContainText("9:00 AM, 9:30 AM, 10:00 AM");
  await expect(preview).toContainText("(Atlanta time (ET))");

  // Payouts not set up: customers can't book yet, and it says where to fix it.
  await data.env.db.from("providers").update({ stripe_payouts_enabled: false }).eq("id", p);
  await page.reload();
  await expect(preview.getByText("Customers can't book until payouts are set up.")).toBeVisible();
  await expect(preview.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/dashboard/payouts");

  // In the listing's own sidebar too.
  await page.goto(`/dashboard/listings/${listing.id}`);
  await expect(page.getByRole("heading", { name: "Times customers will see" })).toBeVisible();
});

test("the listing editor: a Service's mode is required with nothing chosen; mode and buffer change while live", async ({ page, context, data }) => {
  test.setTimeout(120_000);
  const p = await provider(data, page, context);
  const area = await data.area();
  const cat = (await data.category("service")).id;

  // A new Service: nothing preselected; saving without a mode says what to do.
  await page.goto("/dashboard/listings/new?kind=service");
  const mode = page.getByRole("radiogroup", { name: /How customers book/ });
  await expect(mode.getByRole("radio", { checked: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(page.getByText("Choose how customers book this Service.")).toBeVisible();
  await expect(page.getByText("Enter how long the Service takes.")).toBeVisible();
  // The form never saves a Service draft without a mode and a duration: nothing was made.
  expect((await data.env.db.from("listings").select("id").eq("provider_id", p)).data, "no listing saved").toEqual([]);

  // A live Service: switch to instant, and a 30-minute buffer; saved.
  const listing = await data.listing(p, "service", cat, area, `Mode cut ${data.run}`);
  // At the provider's place, so it has an address (the form requires one).
  await data.env.db.from("listing_addresses").insert({ listing_id: listing.id, line1: "1 Test Street", city: "Atlanta", state: "GA", postal_code: "30312" });
  await page.goto(`/dashboard/listings/${listing.id}`);
  await expect(page.getByRole("radio", { name: /I approve each booking/ })).toBeChecked();
  await page.getByRole("radio", { name: /Customers book instantly/ }).click();
  await choose(page, page.getByLabel("Time after each booking"), "30 minutes");
  await page.getByRole("button", { name: "Save changes" }).first().click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect.poll(async () => {
    const { data: l } = await data.env.db.from("listings").select("booking_mode, buffer_minutes").eq("id", listing.id).single();
    return `${l?.booking_mode} ${l?.buffer_minutes}`;
  }).toBe("instant 30");
});

test("@phone the Availability page at phone width: no sideways scrolling, 44px controls", async ({ page, context, data }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await provider(data, page, context);
  await page.goto("/dashboard/availability");
  await page.getByRole("checkbox", { name: "Open on Monday" }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scrolling").toBeLessThanOrEqual(375);
  for (const name of ["Save weekly hours", "Save hours for this date", "Add time off", "Save booking settings"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.height, `${name}: 44px tall`).toBeGreaterThanOrEqual(44);
  }
});

export type { Locator };

// Found 2026-10-19 (under four workers): "Open on Monday" clicked before the
// page had hydrated did nothing, and the test waited out its 90 seconds for
// Monday's hours. A page loaded in a test is now used once it has hydrated
// (e2e/support/fixtures.ts, <html data-hydrated>), as a person uses it once
// it responds. Its scripts held back two seconds here, the click still counts.
test("a click straight after loading counts, even when the page's scripts are slow", async ({ page, context, data }) => {
  await provider(data, page, context);
  await page.route(/\/_nuxt\/.*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await page.goto("/dashboard/availability");
  await page.getByRole("checkbox", { name: "Open on Monday" }).click();
  await expect(page.getByRole("group", { name: "From (Monday)" })).toBeVisible({ timeout: 10_000 });
});
