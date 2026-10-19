#!/usr/bin/env node
// npm run test:clock: the clock sweep (decided 2026-10-18; every hour since
// 2026-10-19). Runs packages/ui/tests/clock-sweep.test.mts at every instant
// in scripts/clock-instants.mjs (the named edges, and every real hour of a
// Wednesday, a Saturday and both clock-change days, at 5 past and 5 to),
// with the device in Tokyo and in Los Angeles, so nothing can lean on the
// device's zone either. One process per device zone, each looping over the
// instants (the zone is fixed when a process starts).
//
// The database's now() can't be moved: the slot core, which takes a time,
// is checked at the same hours by supabase/tests/slot_instants.test.sql,
// and the tests that use the real clock run at set times in the scheduled
// Clock sweep workflow (.github/workflows/clock-sweep.yml).

import { spawnSync } from "node:child_process";
import { ALL } from "./clock-instants.mjs";

const ZONES = ["Asia/Tokyo", "America/Los_Angeles"];
let failed = 0;
for (const zone of ZONES) {
  const r = spawnSync("npx", ["tsx", "packages/ui/tests/clock-sweep.test.mts"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, TEST_INSTANTS: "all", TZ: zone }, encoding: "utf8",
  });
  const ok = r.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} every instant, device in ${zone}`);
  if (!ok) {
    failed++;
    console.log((r.stdout + r.stderr).split("\n").filter((l) => /^FAIL|Error|failed/.test(l)).map((l) => `       ${l}`).join("\n"));
  }
}
console.log(failed ? `${failed} of ${ZONES.length} device zones failed.` : `The clock sweep passed at all ${ALL().length} instants, in both device zones.`);
process.exit(failed ? 1 : 0);
