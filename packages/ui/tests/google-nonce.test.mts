// googleNonce (Google sign-in): Google gets the SHA-256 fingerprint of the
// value Supabase gets, and every call makes a new one.
// Run: npx tsx packages/ui/tests/google-nonce.test.mts
import { createHash } from "node:crypto";
import { googleNonce } from "../app/utils/googleNonce";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

const a = await googleNonce();
const b = await googleNonce();
check(a.hashed === createHash("sha256").update(a.raw).digest("hex"), "1. Google gets the SHA-256 fingerprint (hex) of Supabase's value");
check(/^[A-Za-z0-9_-]{43}$/.test(a.raw), "2. the value is 32 random bytes, URL-safe");
check(a.raw !== b.raw && a.hashed !== b.hashed, "3. a new one every time");
console.log(failures ? `${failures} failed` : "All Google nonce checks passed.");
process.exit(failures ? 1 : 0);
