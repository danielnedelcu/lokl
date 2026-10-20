import fs from "node:fs";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

// Counts the tests a Playwright run actually ran (not skipped) and adds the
// number to E2E_COUNT_FILE, one line per run (2026-10-20). scripts/e2e.mjs
// runs two phases with --pass-with-no-tests (either may be empty, as a CI
// shard's share of the @serial tests can be) and fails when together they
// ran none, so a wrong path or filter can never look like a pass.
export default class CountReporter implements Reporter {
  private ran = 0;
  onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status !== "skipped" && result.retry === 0) this.ran++;
  }
  onEnd() {
    const file = process.env.E2E_COUNT_FILE;
    if (file) fs.appendFileSync(file, `${this.ran}\n`);
  }
}
