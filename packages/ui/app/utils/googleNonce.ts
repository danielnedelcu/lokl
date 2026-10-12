// The nonce for Google sign-in (Google Identity Services with Supabase's
// signInWithIdToken; docs/design/sign-in-with-code.md, Google): a fresh
// random value each time. Google is given its SHA-256 fingerprint (hex),
// which it puts in the signed sign-in token; Supabase is given the value
// itself and checks the two match, so a token can't be replayed.

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function googleNonce(): Promise<{ raw: string; hashed: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hashed = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return { raw, hashed };
}
