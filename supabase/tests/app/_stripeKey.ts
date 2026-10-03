import fs from "node:fs";

// The Stripe key the Stripe tests use: NUXT_STRIPE_SECRET_KEY from the
// environment (GitHub Actions passes the `stripe-sandbox` environment's
// secret this way), or else the website's own .env, as on a laptop. Each
// test still refuses anything but a test-mode key for the Lokl sandbox.
export function stripeTestKey(): string {
  const fromEnv = process.env.NUXT_STRIPE_SECRET_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = new URL("../../../apps/website/.env", import.meta.url);
  if (!fs.existsSync(file)) return "";
  const env = Object.fromEntries(fs.readFileSync(file, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
  return env.NUXT_STRIPE_SECRET_KEY ?? "";
}
