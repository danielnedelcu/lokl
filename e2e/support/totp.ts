import { createHmac } from "node:crypto";

// The 6-digit code an authenticator app shows for a secret (RFC 6238:
// HMAC-SHA1, 30-second steps), so the journeys can pass the admin's second
// step (docs/design/admin-roles.md). Test logins only.
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * A code not used before for this secret. Supabase accepts the previous,
 * current and next 30-second windows' codes (clocks a little out; checked
 * on the local stack 2026-10-19, which even accepted a code twice). To be
 * safe if repeats are ever refused, each code is used once and in order:
 * the previous window's first, then the current's, then the next's, so it
 * waits only after three uses in one window (it used to wait after one).
 */
const used = new Map<string, number>();
export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const now = Date.now();
    const current = Math.floor(now / 30_000);
    const into = now % 30_000;
    let step = Math.max((used.get(secret) ?? -Infinity) + 1, current - 1);
    // The previous window's code lasts only to this window's end: not in its last 5 seconds.
    if (step === current - 1 && into > 25_000) step = current;
    // Nor the current one's in its last second (the next window's code
    // lasts two more), so nothing expires on its way.
    if (step === current && into > 29_000) {
      await new Promise((r) => setTimeout(r, 1_500));
      continue;
    }
    if (step > current + 1) {
      await new Promise((r) => setTimeout(r, 30_000 - into + 500));
      continue;
    }
    used.set(secret, step);
    return totp(secret, step * 30_000 + 1);
  }
}

/**
 * The authenticator key of each test admin, by email (data.user), so
 * signIn(..., { app: "admin" }) can pass the second step as they would.
 */
export const authenticatorKeys = new Map<string, string>();
