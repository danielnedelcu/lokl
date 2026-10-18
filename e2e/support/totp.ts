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

/** A code not used before for this secret: waits for the next 30-second window if this one's was (a code works once). */
const used = new Map<string, number>();
export async function freshTotp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if (used.get(secret) === step) {
    await new Promise((r) => setTimeout(r, (step + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  // Not in the window's last second, so it can't expire on its way.
  if (Date.now() % 30_000 > 29_000) {
    await new Promise((r) => setTimeout(r, 1_500));
    step = Math.floor(Date.now() / 30_000);
  }
  used.set(secret, step);
  return totp(secret);
}

/**
 * The authenticator key of each test admin, by email (data.user), so
 * signIn(..., { app: "admin" }) can pass the second step as they would.
 */
export const authenticatorKeys = new Map<string, string>();
