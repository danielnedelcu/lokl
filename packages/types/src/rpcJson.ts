import type { z } from "zod";
import { RPC_SHAPES, type RpcJson, type RpcJsonName } from "./rpcShapes";

// Reads a database function's JSON result through its schema (./rpcShapes.ts),
// the way rowLimitFetch watches for cut-off reads:
// - "throw" (the test apps, the app tests): a result that doesn't match fails,
//   naming the function and each path that's wrong;
// - "warn" (production, the default): the same is logged, and the data is
//   returned as it came, so a drift is reported rather than becoming an outage.
// Only paths and what was expected are ever reported, never values: rows
// carry names, emails and money.

export type RpcShapeMode = "throw" | "warn";
let mode: RpcShapeMode = "warn";

/** Set by the apps' row-limit plugins (runtimeConfig.public.rpcShapeCheck) and the app tests. */
export function setRpcShapeCheck(next: RpcShapeMode) {
  mode = next;
}

/** "rows.3.total_cents: expected number" for each problem, without the values. */
export function shapeProblems(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const where = i.path.length ? i.path.map(String).join(".") : "(the whole result)";
    const expected = "expected" in i && i.expected ? `expected ${String(i.expected)}` : i.code === "invalid_value" ? "not an allowed value" : i.code;
    return `${where}: ${expected}`;
  });
}

/** The error thrown (or logged) for a result that doesn't match its schema. */
export class RpcShapeError extends Error {
  constructor(readonly fn: string, readonly problems: string[]) {
    super(`${fn} returned an unexpected shape: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more` : ""}`);
    this.name = "RpcShapeError";
  }
}

/** `data` from rpc(name), checked against its schema and typed by it. */
export function rpcJson<N extends RpcJsonName>(name: N, data: unknown): RpcJson<N> {
  const parsed = RPC_SHAPES[name].safeParse(data);
  if (parsed.success) return parsed.data as RpcJson<N>;
  const problem = new RpcShapeError(name, shapeProblems(parsed.error));
  if (mode === "throw") throw problem;
  console.warn(`[rpc] ${problem.message}`);
  return data as RpcJson<N>;
}
