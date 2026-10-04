// The profile contact-details rule (packages/types/src/providers.ts), with
// the same samples as supabase/tests/provider_profiles.test.sql, so the
// browser's check and the database's agree; and the message says what the
// text looks like.
// Run: npx tsx packages/ui/tests/contact-details.test.mts (part of `npm run test:ui`).
import { contactDetailsMessage, findContactDetails } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const contact: [string, string][] = [
  ["Call me at 404-555-0182", "phone"],
  ["+1 404 555 0182", "phone"],
  ["email me: sam@peachtours.com", "email"],
  ["see peachtours.com", "web"],
  ["www.peachtours", "web"],
  ["Guiding tours 2015-2020", "phone"],
];
const fine = [
  "Food walks since 2019 in Old Fourth Ward",
  "Tours at 10:00 AM and 2:30 PM",
  "Over 1,500 happy guests",
  "St. Louis-born, Atlanta-raised",
  "Guiding tours 2015 to 2020",
];
for (const [text, kind] of contact) check(findContactDetails(text)?.kind === kind, `"${text}" looks like ${kind === "web" ? "a web address" : `a${kind === "email" ? "n" : ""} ${kind}`}`);
for (const text of fine) check(findContactDetails(text) === null, `"${text}" is fine`);

const yearRange = contactDetailsMessage("Guiding tours 2015-2020") ?? "";
check(yearRange.startsWith("“2015-2020” looks like a phone number") && yearRange.includes("“2015 to 2020”"),
  "a year range is called a phone number, with how to write it");
check(contactDetailsMessage("email me: sam@peachtours.com")!.startsWith("“sam@peachtours.com” looks like an email address"), "an email is named as one");

console.log(failures ? `${failures} failed` : "All contact-details checks passed.");
process.exit(failures ? 1 : 0);
