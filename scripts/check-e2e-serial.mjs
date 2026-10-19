// check:e2e-serial (2026-10-19): the browser tests run four at a time, and a
// test that changes what the whole site shares must run alone, tagged
// @serial (e2e/playwright.config.ts). This fails on a test that, itself or
// through a helper in its file, runs a timed job (data.job: it works over
// every booking), sets the homepage's guides, or changes the commission
// rates, without the tag. Reading shared things (the admin bell, Atlanta's
// carousels, site-wide totals) can't be told from the code: the config's
// note says when to tag those too.
//
//   node scripts/check-e2e-serial.mjs
import fs from "node:fs";
import path from "node:path";

const dir = new URL("../e2e/journeys/", import.meta.url).pathname;
const SHARED = [
  [/\bdata\.job\(/, "runs a timed job over every booking (data.job)"],
  [/\bsetHomepage\(/, "sets the homepage's guides (setHomepage)"],
  [/\bhomepage_features\b/, "writes the homepage's guides (homepage_features)"],
  [/\bcommission_rates\b/, "changes the commission rates"],
];

/** A file's top-level pieces: each starts at a line with no indent (a test, a helper, a constant). */
function pieces(src) {
  const lines = src.split("\n");
  const out = [];
  let current = null;
  lines.forEach((line, i) => {
    if (/^\S/.test(line) && !/^[})\]]/.test(line) && !line.startsWith("//")) {
      current = { start: i + 1, text: "" };
      out.push(current);
    }
    if (current) current.text += `${line}\n`;
  });
  return out;
}

const problems = [];
let tests = 0;
let tagged = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).sort()) {
  const parts = pieces(fs.readFileSync(path.join(dir, name), "utf8"));
  // Helpers in the file that touch shared things, by name.
  const helpers = new Map();
  for (const p of parts) {
    const fn = p.text.match(/^(?:async )?function (\w+)|^const (\w+) = (?:async )?\(/);
    const why = SHARED.find(([re]) => re.test(p.text));
    if (fn && why) helpers.set(fn[1] ?? fn[2], why[1]);
  }
  for (const p of parts) {
    // A test, or a loop that makes tests (its tests share one tag line each).
    const isTest = /^test\(/.test(p.text);
    const makesTests = !isTest && /^\s+test\(/m.test(p.text) && !/^(?:async )?function |^const /.test(p.text);
    if (!isTest && !makesTests) continue;
    tests++;
    const tagLine = isTest ? p.text.split("\n")[0] : p.text;
    const isSerial = /\{\s*tag:\s*(?:"@serial"|\[[^\]]*"@serial")/.test(tagLine);
    if (isSerial) tagged++;
    const direct = SHARED.find(([re]) => re.test(p.text))?.[1];
    const viaHelper = [...helpers].find(([h]) => new RegExp(`\\b${h}\\(`).test(p.text));
    const why = direct ?? (viaHelper && `${viaHelper[1]}, through ${viaHelper[0]}()`);
    if (why && !isSerial) {
      const title = p.text.match(/test\(["`]((?:[^"`\\]|\\.)*)["`]/)?.[1] ?? "?";
      problems.push(`e2e/journeys/${name}:${p.start} "${title}" ${why}, so it must be tagged { tag: "@serial" }.`);
    }
  }
}
if (problems.length) {
  console.error(`check:e2e-serial:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check:e2e-serial: ${tests} tests and test loops; the ${tagged} that change or read what the whole site shares run alone (@serial).`);
