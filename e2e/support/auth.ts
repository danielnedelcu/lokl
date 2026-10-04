import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { testEnv } from "./env";

// Signing a test user in without email (decided 2026-10-04): the password
// sign-in runs here, in the test, through @supabase/ssr (the library the
// apps use for their cookies), and the cookies it writes are given to the
// browser. Nothing in the apps knows about tests. If the library changes
// its cookie format, both sides change together; a mismatch shows as a
// signed-out page, not a quiet pass.
export async function signIn(context: BrowserContext, email: string, password: string) {
  const env = await testEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(env.apiUrl, env.publishableKey, {
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
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" as const })),
  );
}
