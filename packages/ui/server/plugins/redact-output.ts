import { installRedactingOutput } from "@repo/types";

// The backstop for keys in logs, in both apps and in production
// (decided 2026-10-11): everything the server writes to stdout and stderr,
// its own logger and uncaught errors included, goes through redactSecrets.
// Stripe errors are already redacted at the source (safeStripe); this
// catches anything else that quotes a key.
export default defineNitroPlugin(() => {
  installRedactingOutput();
});
