import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the booking journeys (docs/TODO.md, Automated checks;
// plan approved 2026-10-04). Run with `npm run test:e2e`, which starts the
// apps on 3200 (website) and 3201 (admin) against the local stack first.
//
// - Chromium at desktop size for every journey, plus a phone-size run of
//   journey 1. WebKit waits for the staging site (docs/TODO.md): production
//   cookies are Secure, and WebKit refuses them on plain-http localhost.
// - The browser runs in Los Angeles time on purpose: the pages must still
//   show Atlanta times.
// - One test at a time: the journeys share the Lokl sandbox and the local
//   stack, and each is a few page loads long.
export default defineConfig({
  testDir: "./journeys",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3200",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
});
