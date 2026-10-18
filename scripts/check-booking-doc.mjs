#!/usr/bin/env node
// npm run check:booking-doc: docs/architecture/booking-and-payments.md
// points at the booking guard as it is (2026-10-18). Its short-forms table
// and section 2 had drifted to older migrations: every link the document
// labels as the guard must name the newest migration that defines
// public.bookings_guard, and the table's count of migrations defining it
// must be right. A migration that redefines the guard then fails here until
// the document follows.
//
//   node scripts/check-booking-doc.mjs                 the repo
//   node scripts/check-booking-doc.mjs <doc> <folder>  another document and migrations folder (tests)

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const docPath = process.argv[2] ?? path.join(root, "docs/architecture/booking-and-payments.md");
const migrations = process.argv[3] ?? path.join(root, "supabase/migrations");

const DEFINES = /create\s+(or\s+replace\s+)?function\s+public\.bookings_guard\s*\(/i;
const defining = fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => DEFINES.test(fs.readFileSync(path.join(migrations, f), "utf8")));
const problems = [];
if (!defining.length) problems.push("no migration defines public.bookings_guard");
const newest = defining.at(-1);
const doc = fs.readFileSync(docPath, "utf8");

// Every guard link: the short-forms row ("| guard | ... [path](...)") and
// links whose text is "guard" ("([guard](...))").
const rowLinks = [...doc.matchAll(/^\| guard \|.*$/gm)].flatMap((m) => [...m[0].matchAll(/\]\(([^)]+\.sql)\)/g)].map((l) => l[1]));
const textLinks = [...doc.matchAll(/\[guard\]\(([^)]+)\)/g)].map((m) => m[1]);
const links = [...rowLinks, ...textLinks];
if (!rowLinks.length) problems.push('no "| guard |" row in the short-forms table');
if (!textLinks.length) problems.push("no [guard](...) link (section 2)");
for (const link of links) {
  if (path.basename(link) !== newest) problems.push(`a guard link names ${path.basename(link)}; the newest migration defining bookings_guard is ${newest}`);
}

// The count, written as a word ("defined in nine migrations").
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const count = doc.match(/defined in (\w+) migrations/);
if (!count) problems.push('the guard row doesn\'t say how many migrations define it ("defined in N migrations")');
else if (count[1] !== WORDS[defining.length] && count[1] !== String(defining.length)) {
  problems.push(`the guard row says "defined in ${count[1]} migrations"; ${defining.length} define it`);
}

if (problems.length) {
  console.error(`check:booking-doc: ${path.relative(root, docPath) || docPath} is out of date with the booking guard:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check:booking-doc: the guard's ${links.length} links name ${newest}, the newest of the ${defining.length} migrations defining it.`);
