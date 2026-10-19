// Keeping keys and key fragments out of logs and stored text (sanitising
// Stripe errors, 2026-10-11). Stripe's messages can quote a key, masked to
// its prefix and last four ("Invalid API Key provided: sk_test_****9Zq7"),
// and GitHub masks only the exact secret value, not such fragments. Layers:
//   - safeStripe: every Stripe call's error is redacted in place at the source;
//   - logText (logs.ts) and stripeErrorSummary: anything stored or logged;
//   - installRedactingOutput: the process's stdout and stderr, a backstop in
//     the servers (production too) and the test runners.

/** Anything key-shaped, whole or masked, replaced; ids that aren't secrets (acct_, pi_, cs_test_...) are kept. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:pi|seti|cs)_[A-Za-z0-9]+_secret_[A-Za-z0-9*]+/g, "[client secret]")
    .replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+/g, "[key]")
    .replace(/\bwhsec_[A-Za-z0-9*]+/g, "[webhook secret]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_*-]+/g, "[key]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=*-]+/gi, "Bearer [token]");
}

/** Redacts an error's message, raw.message (Stripe) and stack in place, keeping its class and fields; returns it. */
export function redactError<T>(e: T): T {
  if (!e || typeof e !== "object") return e;
  const err = e as { message?: unknown; stack?: unknown; raw?: { message?: unknown } };
  try {
    if (typeof err.message === "string") err.message = redactSecrets(err.message);
    if (typeof err.stack === "string") err.stack = redactSecrets(err.stack);
    if (err.raw && typeof err.raw.message === "string") err.raw.message = redactSecrets(err.raw.message);
  } catch {
    // A read-only field: the output backstop still covers it.
  }
  return e;
}

/**
 * Options for every Stripe client (2026-10-19): `new Stripe(key,
 * STRIPE_CLIENT_OPTIONS)`. Two retries, with a back-off and the same
 * idempotency key (so a retry can't charge twice), for what Stripe says may
 * be retried: a dropped connection, a 5xx, a 409, a 429 lock timeout. Two
 * is the Node library's default today; it's set here so an update can't
 * lower it, now that CI's Stripe jobs run side by side. A 429 for the rate
 * limit itself isn't retried by the library (docs.stripe.com/rate-limits).
 */
export const STRIPE_CLIENT_OPTIONS = { maxNetworkRetries: 2 } as const;

/**
 * A Stripe client whose errors are redacted where they happen: every call
 * that fails rethrows the same error (same class, type, code, statusCode)
 * with its message, raw.message and stack cleaned. Lists stay iterable.
 */
export function safeStripe<T extends object>(client: T): T {
  const wrapResult = (r: unknown): unknown => {
    if (!r || typeof (r as PromiseLike<unknown>).then !== "function") return r;
    return new Proxy(r as object, {
      get(t, prop) {
        const v = Reflect.get(t, prop, t);
        if (prop === "then") {
          return (ok?: (x: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            (t as PromiseLike<unknown>).then(ok, (e) => {
              const clean = redactError(e);
              if (bad) return bad(clean);
              throw clean;
            });
        }
        if (prop === "catch") return (bad: (e: unknown) => unknown) => (t as Promise<unknown>).catch((e) => bad(redactError(e)));
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  };
  const wrap = (target: object): object => new Proxy(target, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (typeof v === "function") {
        return (...args: unknown[]) => {
          try {
            return wrapResult(v.apply(t, args));
          } catch (e) {
            throw redactError(e);
          }
        };
      }
      if (v && typeof v === "object" && typeof prop === "string" && !prop.startsWith("_")) return wrap(v);
      return v;
    },
  });
  return wrap(client) as T;
}

let installed = false;
/**
 * The backstop: everything this process writes to stdout and stderr (console,
 * the server's logger) goes through redactSecrets, and an uncaught error is
 * redacted before Node prints it.
 */
export function installRedactingOutput() {
  if (installed || typeof process === "undefined" || !process.stdout?.write) return;
  installed = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) =>
      write(typeof chunk === "string" ? redactSecrets(chunk)
        : chunk instanceof Uint8Array ? redactSecrets(Buffer.from(chunk).toString("utf8")) : chunk, ...rest)) as typeof stream.write;
  }
  // Node prints an uncaught error itself, not through stderr.write. A monitor
  // runs just before that and redacts the error in place, changing nothing
  // else: the process still prints it and exits as it would have.
  process.on("uncaughtExceptionMonitor", (e) => redactError(e));
}
