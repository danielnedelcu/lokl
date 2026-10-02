// Sign-in goes back where it was saved, once (packages/ui/app/utils/signInRedirect.ts).
// Run: npx tsx packages/ui/tests/sign-in-redirect.test.mts
import { createSignInRedirect } from "../app/utils/signInRedirect";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

// A cookie that, like the real one, is cleared by reading it.
const cookie = (value: string | null) => {
  let v = value;
  return () => { const out = v; v = null; return out; };
};

{
  const went: string[] = [];
  const r = createSignInRedirect({ takeSaved: cookie("/experiences/taco-crawl-abc123"), fallback: "/dashboard", go: (p) => went.push(p) });
  r.onUser(null);                  // before sign-in finishes
  r.onUser({ sub: "u1" });         // the session arrives
  r.onUser({ sub: "u1", email: "a@b.c" }); // then its claims: the old bug sent this one to /dashboard
  r.onUser({ sub: "u1" });
  check(went.length === 1, `1a. it navigates once, however often the user changes (${went.length})`);
  check(went[0] === "/experiences/taco-crawl-abc123", `1b. it goes back to the saved listing (${went[0]})`);
}
{
  const went: string[] = [];
  const r = createSignInRedirect({ takeSaved: cookie(null), fallback: "/dashboard", go: (p) => went.push(p) });
  r.onUser({ sub: "u1" });
  check(went.join() === "/dashboard", "2. with nothing saved, it goes to the fallback");
}
{
  const went: string[] = [];
  createSignInRedirect({ takeSaved: cookie("https://evil.example/phish"), fallback: "/dashboard", go: (p) => went.push(p) }).onUser({ sub: "u1" });
  createSignInRedirect({ takeSaved: cookie("//evil.example"), fallback: "/dashboard", go: (p) => went.push(p) }).onUser({ sub: "u1" });
  check(went.join() === "/dashboard,/dashboard", "3. a saved address on another site is never used");
}
{
  const went: string[] = [];
  const r = createSignInRedirect({ takeSaved: cookie("/account/bookings"), fallback: "/", go: (p) => went.push(p) });
  r.onUser(null);
  check(went.length === 0, "4. nothing happens until someone is signed in");
}
console.log(failures ? `${failures} failed` : "All sign-in redirect checks passed.");
process.exit(failures ? 1 : 0);
