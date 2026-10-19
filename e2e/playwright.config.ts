import { defineConfig, devices } from "@playwright/test";
import { installRedactingOutput } from "@repo/types";

// End-to-end tests of the booking journeys (docs/TODO.md, Automated checks;
// plan approved 2026-10-04). Run with `npm run test:e2e`, which starts the
// apps on 3200 (website) and 3201 (admin) against the local stack first.
//
// - Chromium at desktop size for every journey, plus a phone-size run of
//   journey 1. WebKit waits for the staging site (docs/TODO.md): production
//   cookies are Secure, and WebKit refuses them on plain-http localhost.
// - The browser runs in Los Angeles time on purpose: the pages must still
//   show Atlanta times.
// - Three tests at a time locally, four per CI shard (2026-10-19;
//   E2E_WORKERS to change it): each test
//   makes its own users, providers (each with a made-up Stripe account of
//   its own), listings, categories and areas, and finds them by name. A
//   test that changes or reads something the whole site shares is tagged
//   @serial and runs afterwards, alone (scripts/e2e.mjs runs the "serial"
//   project second, with one worker): a timed job (it runs over every
//   booking), the homepage's guides, the commission rates, Atlanta's
//   carousels or exact counts, the admin bell (every report notifies every
//   admin) or the admin's site-wide totals. scripts/check-e2e-serial.mjs
//   fails on a test that runs a job, sets the homepage or changes the rates
//   without the tag; the rest is up to whoever writes the test.
// No key fragments in the test runner's output, its error reports included.
installRedactingOutput();

export default defineConfig({
  testDir: "./journeys",
  fullyParallel: true,
  // Three locally, four per CI shard (measured 2026-10-19: on a 10-core
  // machine, four workers took no less time than three, with the load at
  // twice the cores and live-update tests failing; three passed every run).
  workers: Number(process.env.E2E_WORKERS ?? (process.env.CI ? 4 : 3)),
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The serial run's report goes in its own folder (E2E_REPORT, scripts/e2e.mjs).
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: process.env.E2E_REPORT ?? "playwright-report" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3200",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@serial/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
    // The time-zone journeys again, with the browser ahead of Atlanta, in a
    // zone whose clock changes fall in the opposite season.
    { name: "ahead", use: { ...devices["Desktop Chrome"], timezoneId: "Pacific/Auckland" }, grep: /@zones/ },
    // Tests that change or read what the whole site shares: one at a time,
    // after the others (scripts/e2e.mjs runs this project on its own).
    // Its own results folder: each Playwright run clears the folders of the
    // projects it runs, so the first run's failures are kept.
    { name: "serial", use: { ...devices["Desktop Chrome"] }, grep: /@serial/, workers: 1, fullyParallel: false, outputDir: "test-results/serial" },
  ],
});
