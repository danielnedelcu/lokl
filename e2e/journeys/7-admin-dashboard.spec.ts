import { daysFromNow } from "../support/data";
import { signIn } from "../support/auth";
import { ADMIN } from "../support/env";
import { expect, test } from "../support/fixtures";

// Journey 7: the admin dashboard shows real numbers, and each money card
// opens Bookings filtered to the same payments, whose totals agree.

const cents = (money: string) => Math.round(Number(money.replace(/[$,]/g, "")) * 100);

test("the dashboard's numbers match the bookings behind them", async ({ page, context, data }) => {
  const admin = await data.user("admin", { admin: true });
  const customer = await data.user("customer");
  const owner = await data.user("owner");
  const provider = await data.provider(owner);
  const category = await data.category("experience");
  const listing = await data.listing(provider, "experience", category.id, await data.area());
  await data.paidBooking(customer, await data.session(listing.id, daysFromNow(4)));
  await signIn(context, admin.email, admin.password);

  await page.goto(`${ADMIN}/`);
  const gmvCard = page.getByRole("link", { name: /GMV \(30 days\)/ });
  await expect(gmvCard).toBeVisible();
  const gmv = cents((await gmvCard.locator("p").nth(1).textContent())!);
  const bookings = Number((await page.getByRole("link", { name: /Bookings \(30 days\)/ }).locator("p").nth(1).textContent())!.replace(/,/g, ""));
  expect(gmv, "GMV includes the test booking paid today ($50.00)").toBeGreaterThanOrEqual(5000);
  expect(bookings).toBeGreaterThanOrEqual(1);

  // The card opens Bookings "paid between" the same days; its totals agree.
  await gmvCard.click();
  await expect(page).toHaveURL(/\/bookings\?paid_from=\d{4}-\d{2}-\d{2}&paid_to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByText(/Showing only: Paid .+ Atlanta time/)).toBeVisible();
  const line = page.getByText(/bookings? · \$[\d,.]+ charged · \$[\d,.]+ refunded/);
  await expect(line).toBeVisible();
  const text = (await line.textContent())!;
  const [, count, charged, refunded] = text.match(/([\d,]+) bookings? · (\$[\d,.]+) charged · (\$[\d,.]+) refunded/)!;
  expect(Number(count!.replace(/,/g, "")), "the same number of bookings").toBe(bookings);
  expect(cents(charged!) - cents(refunded!), "charged less refunded is the dashboard's GMV").toBe(gmv);
});
