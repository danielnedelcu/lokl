// The admin's authenticators (docs/design/admin-roles.md, cutover step 2):
// naming one, showing its key, and when removing one is allowed.
// Run: npx tsx packages/ui/tests/authenticator-rules.test.mts (part of `npm run test:ui`).
import { ADMIN_MFA_REQUIRED, AUTHENTICATOR_NAME_MAX, authenticatorNameProblem, authenticatorRemoval, groupedKey } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures++;
};

// 1. Names.
check(authenticatorNameProblem("Phone", []) === null, "1a. a name is accepted");
check(!!authenticatorNameProblem("   ", []), "1b. an empty name is refused");
check(!!authenticatorNameProblem("x".repeat(AUTHENTICATOR_NAME_MAX + 1), []), "1c. a name over the limit is refused");
check(!!authenticatorNameProblem(" phone ", ["Phone"]), "1d. a name they already use is refused, whatever its case or spaces");

// 2. The key, in groups of four.
check(groupedKey("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP") === "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP", "2a. the key in groups of four");
check(groupedKey("ABCDEF") === "ABCD EF", "2b. ...the last group as long as it is");

// 3. Removing one.
check(ADMIN_MFA_REQUIRED === true, "3a. authenticators are required (since the admin roles migration)");
const lastOptional = authenticatorRemoval(1, false);
check(lastOptional.allowed && /only authenticator/.test(lastOptional.warning ?? ""), "3b. while optional, removing your last is allowed, with a warning");
const lastRequired = authenticatorRemoval(1, true);
check(!lastRequired.allowed && /needs one/.test(lastRequired.warning ?? ""), "3c. once required, removing your last is refused");
check(authenticatorRemoval(2, true).allowed && authenticatorRemoval(2, true).warning === null, "3d. removing one of two is allowed, without a warning, either way");

console.log(failures ? `${failures} failed` : "All authenticator rule checks passed.");
process.exit(failures ? 1 : 0);
