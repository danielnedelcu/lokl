import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { ADMIN_COOKIE, testEnv } from "./env";
import { authenticatorKeys, freshTotp } from "./totp";

// Signing a test user in without email (decided 2026-10-04): the password
// sign-in runs here, in the test, through @supabase/ssr (the library the
// apps use for their cookies), and the cookies it writes are given to the
// browser. Nothing in the apps knows about tests. If the library changes
// its cookie format, both sides change together; a mismatch shows as a
// signed-out page, not a quiet pass.
//
// Each app has its own session cookie (decided 2026-10-17): the website's
// keeps the module's default name, from the project; the admin app's is
// ADMIN_COOKIE (apps/admin/nuxt.config.ts, supabase.cookiePrefix). `app`
// says which one this sign-in writes.
export async function signIn(context: BrowserContext, email: string, password: string, { app = "website" }: { app?: "website" | "admin" } = {}) {
  const env = await testEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(env.apiUrl, env.publishableKey, {
    ...(app === "admin" ? { cookieOptions: { name: ADMIN_COOKIE } } : {}),
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Test sign-in failed: ${error.message}`);
  // The library writes its cookies just after the sign-in resolves.
  for (let i = 0; i < 20 && !jar.size; i++) await new Promise((r) => setTimeout(r, 25));
  if (!jar.size) throw new Error("Test sign-in wrote no cookies.");
  // An admin with an authenticator passes the second step too, as they
  // would on /security/verify (journey 38 goes through that page itself).
  const key = app === "admin" ? authenticatorKeys.get(email) : undefined;
  if (key) {
    const before = JSON.stringify([...jar]);
    const { data: factors } = await client.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === "verified");
    if (!factor) throw new Error("The test admin has no authenticator.");
    const { error: stepError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: await freshTotp(key) });
    if (stepError) throw new Error(`Test second step failed: ${stepError.message}`);
    for (let i = 0; i < 20 && JSON.stringify([...jar]) === before; i++) await new Promise((r) => setTimeout(r, 25));
    if (JSON.stringify([...jar]) === before) throw new Error("The second step wrote no cookies.");
  }
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" as const })),
  );
}
