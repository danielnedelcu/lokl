import { execFileSync } from "node:child_process";
import { atlantaDate, atlantaTime } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";
import { zonedToInstant } from "../../packages/ui/app/utils/zonedTime";

// Journey 19: times late at night in Atlanta (already tomorrow in UTC) and
// in the week of a clock change, shown the same everywhere: the listing, the
// customer's booking and its free-cancellation time, the provider's booking
// and listings, and the admin's booking. The test apps' server runs in
// Tokyo (ahead of Atlanta) and the browser in Los Angeles (behind), or in
// Auckland (the "ahead" project, with clock changes in the opposite season),
// so anything that followed a device's zone would show a different day.
// Pages rendered on the server must match what the browser renders (no
// hydration mismatch).

const ATL = "America/New_York";
const day = (t: number) => new Date(t).toISOString().slice(0, 10); // a UTC calendar day, for date arithmetic only

/** The next US clock change at least `days` days away: the 2nd Sunday of March or the 1st of November. */
function nextClockChange(days: number): string {
  const after = Date.now() + days * 864e5;
  const sunday = (y: number, month: number, nth: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return Date.UTC(y, month, 1 + ((7 - first) % 7) + (nth - 1) * 7);
  };
  const y = new Date(after).getUTCFullYear();
  const candidates = [sunday(y, 2, 2), sunday(y, 10, 1), sunday(y + 1, 2, 2), sunday(y + 1, 10, 1)];
  return day(candidates.find((t) => t > after)!);
}

test("late at night and in the clock-change week, every page shows the Atlanta time @zones", async ({ page, context, data }) => {
  const hydration: string[] = [];
  page.on("console", (m) => { if (/hydrat/i.test(m.text())) hydration.push(m.text()); });

  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const admin = await data.user("admin", { admin: true });
  const provider = await data.provider(owner);
  const listing = await data.listing(provider, "experience", (await data.category("experience")).id, await data.area());

  // 11:30 PM in Atlanta, four days out: already the next day in UTC and in Tokyo.
  const late = zonedToInstant({ date: day(Date.now() + 4 * 864e5), time: "23:30" }, ATL);
  // 10:00 AM in Atlanta on the Monday after the next clock change.
  const change = nextClockChange(3);
  const afterChange = zonedToInstant({ date: day(Date.parse(`${change}T12:00:00Z`) + 864e5), time: "10:00" }, ATL);
  // 30 hours out: inside 48 hours, so a booking made now is free to cancel for its first hour.
  const soon = new Date(Date.now() + 30 * 3600_000).toISOString();
  const lateSession = await data.session(listing.id, late, 4);
  await data.session(listing.id, afterChange, 4);
  const soonSession = await data.session(listing.id, soon, 4);

  // The listing, as a visitor sees it: each session on its Atlanta date and time.
  await page.goto(`/experiences/${listing.slug}`);
  for (const t of [late, afterChange]) {
    await expect(page.getByRole("listitem").filter({ hasText: atlantaDate(t) }).filter({ hasText: atlantaTime(t) }), `the session at ${t}`).toBeVisible();
  }
  expect(atlantaTime(late)).toBe("11:30 PM");
  expect(atlantaTime(afterChange)).toBe("10:00 AM");

  // The customer's booking of the late session, and the free-cancellation
  // time of a booking just made for the soon one.
  const lateBooking = await data.paidBooking(customer, lateSession);
  const soonBooking = await data.paidBooking(customer, soonSession);
  await signIn(context, customer.email, customer.password);
  await page.goto(`/account/bookings/${lateBooking.id}`);
  await expect(page.getByText(`${atlantaDate(late)}, ${atlantaTime(late)}`).first()).toBeVisible();
  await page.goto(`/account/bookings/${soonBooking.id}`);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  const graceEnds = new Date(Date.parse((await data.booking(soonBooking.id)).confirmed_at) + 3600_000).toISOString();
  await expect(page.getByRole("alertdialog")).toContainText(`This is free until ${atlantaDate(graceEnds)}, ${atlantaTime(graceEnds)}.`);
  await page.keyboard.press("Escape");

  // The provider: the booking, and the listing's "Last changed" date, set to
  // 03:30 UTC (the evening before in Atlanta).
  const changedAt = `${day(Date.now() - 2 * 864e5)}T03:30:00Z`;
  execFileSync("psql", [data.env.dbUrl, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: `
    begin; set local session_replication_role = replica;
    update public.listings set updated_at = '${changedAt}' where id = '${listing.id}';
    commit;` });
  await context.clearCookies();
  await signIn(context, owner.email, owner.password);
  await page.goto(`/dashboard/bookings/${lateBooking.id}`);
  await expect(page.getByText(`${atlantaDate(late)}, ${atlantaTime(late)}`).first()).toBeVisible();
  await page.goto("/dashboard/experiences");
  const changedInAtlanta = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: ATL }).format(new Date(changedAt));
  await expect(page.getByText(`Last changed ${changedInAtlanta}`)).toBeVisible();

  // The admin's booking page.
  await context.clearCookies();
  await signIn(context, admin.email, admin.password, { app: "admin" });
  await page.goto(`${ADMIN}/bookings/${lateBooking.id}`);
  await expect(page.getByText(`${atlantaDate(late)}, ${atlantaTime(late)}`).first()).toBeVisible();

  expect(hydration, "server-rendered pages match the browser's").toEqual([]);
});
