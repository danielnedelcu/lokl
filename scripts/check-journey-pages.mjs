// check:journey-pages (2026-10-19): every page of both apps is named by at
// least one browser journey (scripts/journey-map.mjs), so check:quick can
// pick the journeys a page change needs, and no page goes untested without
// anyone deciding so. A page no journey reaches yet is listed below with its
// reason; the list only shrinks: the check also fails when a listed page
// has gained a journey (take it off). A page reached only by clicking needs
// its journey to check the address where it lands (toHaveURL).
//
//   node scripts/check-journey-pages.mjs
import { journeys, journeysFor, pages } from "./journey-map.mjs";

/** Pages no journey reaches yet (found 2026-10-19, docs/TODO.md). */
const NO_JOURNEY_YET = {
  "website /[market]/guides/[slug]": "a guide's page: no journey opens one yet (journey 21 checks the homepage's guide cards)",
  "website /dashboard/services": "a provider's Services list: no journey yet",
  "website /help/customers": "the customers' help page: no journey yet (journey 36 covers the help centre's articles)",
  "admin /categories": "categories: no journey yet",
  "admin /cities": "markets and areas: no journey yet",
  "admin /confirm": "the emailed sign-in link's landing page: no journey yet (sign-in journeys use the code)",
  "admin /content/[id]/preview": "a guide's preview: no journey yet",
  "admin /listings/experiences": "the Experiences list: no journey yet",
  "admin /listings/services": "the Services list: no journey yet",
};

const all = journeys();
const problems = [];
let covered = 0;
const allPages = pages();
for (const p of allPages) {
  const key = `${p.app} ${p.route}`;
  const by = journeysFor(p, all);
  if (by.length) {
    covered++;
    if (key in NO_JOURNEY_YET) problems.push(`${key} (${p.file}) now has a journey (${by[0]}): take it off NO_JOURNEY_YET in scripts/check-journey-pages.mjs.`);
  } else if (!(key in NO_JOURNEY_YET)) {
    problems.push(`${key} (${p.file}) is named by no browser journey: add one that visits it (or checks its address with toHaveURL where a click lands there), or list it in NO_JOURNEY_YET with the reason.`);
  }
}
for (const key of Object.keys(NO_JOURNEY_YET)) {
  if (!allPages.some((p) => `${p.app} ${p.route}` === key)) problems.push(`NO_JOURNEY_YET lists ${key}, which isn't a page any more: take it off.`);
}
if (problems.length) {
  console.error(`check:journey-pages:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check:journey-pages: ${covered} of ${allPages.length} pages are named by a browser journey; ${Object.keys(NO_JOURNEY_YET).length} have none yet, each listed with its reason.`);
