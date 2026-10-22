import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Chooses an option in a dropdown (ui-thing's Select, which Reka UI runs)
 * the way a person does: open it, wait until the option is shown and the
 * menu has finished opening (its 150 ms zoom and slide: no animation still
 * running), click once, and check the trigger now shows it. A pick that
 * doesn't take fails here, by name. No retry: a pick that can be lost is a
 * finding, not noise.
 *
 * Why (2026-10-20): on a busy CI runner journey 27 clicked "10" in an hour
 * menu before the menu had finished opening (run 39355226668: the trace's
 * snapshot before the click shows the list without its options yet); the
 * menu closed with 9 still chosen, and the test only failed ten steps later
 * as "expected 10, got 9".
 */
export async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await expect(page.getByRole("listbox"), "no other menu is open").toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole("listbox");
  const item = menu.getByRole("option", { name: option, exact: typeof option === "string" });
  await expect(item).toBeVisible();
  await expect.poll(() => menu.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length),
    { message: "the menu has finished opening" }).toBe(0);
  await item.click();
  const shown = typeof option === "string" ? new RegExp(`^\\s*${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) : option;
  await expect(trigger, `the pick of ${String(option)} took`).toHaveText(shown);
}

/**
 * Saves a form a second time while its first "saved" message is still up,
 * holding the save on its way, and checks the first message is taken down
 * within a second (useSaveMessages), before the answer comes back; then
 * releases it and checks this save's own answer and message. `path` is the
 * save request's path (its first non-GET request is held); `save` presses
 * Save.
 *
 * Why (2026-10-21): journey 27 once read the previous save's "Weekly hours
 * saved." as the success of a save the gateway had refused. Messages last 7
 * seconds, so "gone within a second" means taken down, not timed out.
 */
export async function savedAgainTakesDownMessage(page: Page, message: string, path: string, save: () => Promise<void>) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let holding = true;
  await page.route(`**${path}`, async (route) => {
    if (holding && route.request().method() !== "GET") {
      holding = false;
      await held;
    }
    await route.fallback();
  });
  const answer = page.waitForResponse((r) => r.url().includes(path) && r.request().method() !== "GET");
  await expect(page.getByText(message), "the earlier save's message is still up").toBeVisible();
  await save();
  await expect(page.getByText(message), "the earlier save's message is taken down").toHaveCount(0, { timeout: 1000 });
  release();
  const res = await answer;
  expect(res.ok(), `the second save was answered (${res.status()})`).toBe(true);
  await expect(page.getByText(message)).toBeVisible();
  await page.unroute(`**${path}`);
}
