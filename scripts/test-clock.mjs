#!/usr/bin/env node
// npm run test:clock: the clock sweep (decided 2026-10-18). Runs
// packages/ui/tests/clock-sweep.test.mts at each instant that has broken a
// test or could, with the device in Tokyo and in Los Angeles, so nothing
// can lean on the device's zone either. The instants are fixed, in Atlanta
// time, so every run checks the same edges.
//
// The database's now() can't be moved, so the tests that use the real clock
// run at these times of day in the scheduled Clock sweep workflow
// (.github/workflows/clock-sweep.yml) instead.

import { spawnSync } from "node:child_process";

const INSTANTS = [
  ["Friday 3:30 PM (a day's notice leaves one or two times)", "2026-10-23T19:30:00Z"],
  ["Saturday 11:30 PM (the week's last day, nearly over)", "2026-10-25T03:30:00Z"],
  ["Sunday 8:30 AM (a new week; notice crossing the first times)", "2026-10-25T12:30:00Z"],
  ["11:59 PM on the last day of a month", "2026-11-01T03:59:00Z"],
  ["November's repeated hour, the first 1:30 AM (EDT)", "2026-11-01T05:30:00Z"],
  ["November's repeated hour, the second 1:30 AM (EST)", "2026-11-01T06:30:00Z"],
  ["11:59 PM on New Year's Eve", "2027-01-01T04:59:00Z"],
  ["March's skipped hour (2:30 AM doesn't exist; 3:30 AM EDT)", "2027-03-14T07:30:00Z"],
];
const ZONES = ["Asia/Tokyo", "America/Los_Angeles"];

let failed = 0;
for (const [name, instant] of INSTANTS) {
  for (const zone of ZONES) {
    const r = spawnSync("npx", ["tsx", "packages/ui/tests/clock-sweep.test.mts"], {
      cwd: new URL("..", import.meta.url), env: { ...process.env, TEST_NOW: instant, TZ: zone }, encoding: "utf8",
    });
    const ok = r.status === 0;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} (${instant}; device in ${zone})`);
    if (!ok) {
      failed++;
      console.log((r.stdout + r.stderr).split("\n").filter((l) => /^FAIL|Error/.test(l)).map((l) => `       ${l}`).join("\n"));
    }
  }
}
console.log(failed ? `${failed} of ${INSTANTS.length * ZONES.length} runs failed.` : `The clock sweep passed at all ${INSTANTS.length} instants, in both device zones.`);
process.exit(failed ? 1 : 0);
