#!/usr/bin/env node
// npm run check:rpc-json: database functions' JSON is read through its
// schema (rpcJson in @repo/types; decided 2026-10-17).
//
// The generated types say only `Json` for a function that returns jsonb, so
// a cast (`data as Something`) would quietly accept any shape. This fails:
//
// - on an .rpc("name") call, in the apps or the shared packages, to a
//   function whose generated return type is Json, unless the call's result
//   is read through rpcJson("name", …) or asServerPage("name", …) within the
//   lines that follow (a read genuinely done another way says why with a
//   `// rpc-json: <reason>` comment on the line above or the same line);
// - on a function called that way with no schema in RPC_SHAPES
//   (packages/types/src/rpcShapes.ts);
// - on a name in RPC_SHAPES that isn't a JSON function any more.
//
// Static and approximate, like check:reads; the schemas themselves are
// checked at run time (rpcJson throws in the test apps and app tests).

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const problems = [];

// 1. The functions whose generated return type is Json (public schema).
const types = fs.readFileSync(path.join(root, "packages/types/src/database.ts"), "utf8");
const pub = types.slice(types.indexOf("  public: {"));
const fnBlock = pub.slice(pub.indexOf("    Functions: {"), pub.indexOf("    Enums: {"));
const names = [...fnBlock.matchAll(/^ {6}(\w+): \{/gm)].map((m) => ({ name: m[1], at: m.index }));
const jsonFns = new Set();
names.forEach((n, i) => {
  const body = fnBlock.slice(n.at, names[i + 1]?.at ?? fnBlock.length);
  if (/Returns:\s*Json\b/.test(body)) jsonFns.add(n.name);
});
if (!jsonFns.size) problems.push("Found no JSON functions in database.ts: has its layout changed?");

// 2. The names with a schema.
const shapes = fs.readFileSync(path.join(root, "packages/types/src/rpcShapes.ts"), "utf8");
const listBlock = shapes.slice(shapes.indexOf("export const RPC_SHAPES = {"));
const withSchema = new Set([...listBlock.slice(0, listBlock.indexOf("} as const")).matchAll(/^\s+(\w+):/gm)].map((m) => m[1]));
for (const name of withSchema) {
  if (!jsonFns.has(name)) problems.push(`rpcShapes.ts: ${name} has a schema but isn't a JSON function in database.ts.`);
}

// 3. Every .rpc() call to a JSON function, read through its schema.
const DIRS = ["apps/website/app", "apps/website/server", "apps/admin/app", "apps/admin/server", "packages/ui/app", "packages/ui/server", "packages/types/src"];
const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".nuxt", ".output", ".nuxt-check", ".output-check", ".nuxt-secrets", ".output-secrets"].includes(entry.name)) walk(p);
    } else if (/\.(ts|vue|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(p);
  }
};
DIRS.forEach((d) => walk(path.join(root, d)));
const LOOKAHEAD = 25;
let calls = 0;
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\.rpc\(\s*["'](\w+)["']/g)) {
      const name = m[1];
      if (!jsonFns.has(name)) continue;
      calls++;
      const where = `${path.relative(root, file)}:${i + 1}`;
      if (!withSchema.has(name)) problems.push(`${where}: ${name} returns JSON but has no schema in RPC_SHAPES (packages/types/src/rpcShapes.ts).`);
      if (/\/\/\s*rpc-json:/.test(line) || /\/\/\s*rpc-json:/.test(lines[i - 1] ?? "")) continue;
      const after = lines.slice(i, i + LOOKAHEAD).join("\n");
      const read = new RegExp(`(?:rpcJson|asServerPage)\\(\\s*["']${name}["']`);
      if (!read.test(after)) problems.push(`${where}: ${name}'s result isn't read through rpcJson("${name}", …) or asServerPage("${name}", …).`);
    }
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log(`Every JSON function read (${calls} calls, ${withSchema.size} schemas) goes through its schema.`);
