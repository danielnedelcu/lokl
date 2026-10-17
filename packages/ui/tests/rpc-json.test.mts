// rpcJson (@repo/types): a database function's JSON read through its
// schema. "throw" fails naming the function and each wrong path; "warn"
// logs the same and returns the data; neither ever reports a value.
// Run: npx tsx packages/ui/tests/rpc-json.test.mts
import { RpcShapeError, rpcJson, setRpcShapeCheck } from "@repo/types";

let failures = 0;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };
const good = { listings: [{ listing_id: "l1", saved_at: "2026-10-17T00:00:00Z", available: true, title: "A cut" }], providers: [] };
// A drift: a key renamed, and an email where a boolean belongs.
const drifted = { listings: [{ listing_id: "l1", saved_at: "2026-10-17T00:00:00Z", available: "jordan@example.com", name: "A cut" }], providers: [] };

setRpcShapeCheck("throw");
check(rpcJson("my_saved", good).listings[0]?.title === "A cut", "1. a matching result comes back, typed");
const extra = rpcJson("my_saved", { ...good, added_later: 1 }) as Record<string, unknown>;
check(!("added_later" in extra), "2. an extra key is allowed, and dropped");
let thrown: unknown = null;
try { rpcJson("my_saved", drifted); } catch (e) { thrown = e; }
const err = thrown as RpcShapeError;
check(thrown instanceof RpcShapeError && err.fn === "my_saved", "3. throw mode: a drift throws, naming the function");
check(err.problems.some((p) => p.startsWith("listings.0.available")) && err.problems.some((p) => p.startsWith("listings.0.title")),
  `4. ...with each wrong path (${err.problems.join("; ")})`);
check(!err.message.includes("jordan@example.com") && !err.message.includes("A cut"), "5. ...and never a value");
let missing: unknown = null;
try { rpcJson("admin_providers_page", { rows: [] }); } catch (e) { missing = e; }
check(missing instanceof RpcShapeError && (missing as RpcShapeError).problems.some((p) => p.startsWith("total")),
  "6. a missing key fails (no silent defaults)");

setRpcShapeCheck("warn");
const logged: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
const back = rpcJson("my_saved", drifted) as unknown;
console.warn = warn;
check(back === drifted, "7. warn mode: the data comes back as it came");
check(logged.length === 1 && logged[0]!.includes("my_saved") && logged[0]!.includes("listings.0.available"), "8. ...and the drift is logged by name and path");
check(!logged.join(" ").includes("jordan@example.com"), "9. ...never with a value");

console.log(failures ? `${failures} failed` : "All rpcJson checks passed.");
process.exit(failures ? 1 : 0);
