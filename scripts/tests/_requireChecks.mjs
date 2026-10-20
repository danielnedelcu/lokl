// Loaded before every test file the npm scripts run with node or tsx
// (`--import`, see package.json; 2026-10-20): a run that would end
// successfully having printed no passing check ("ok  …") fails instead, so
// a broken copy, a wrong path or a test that returns early can never look
// like a pass. Every test here reports with "ok  " / "FAIL" lines. Its name
// starts with "_" so it isn't a test itself.
let checks = 0;
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  checks += (text.match(/^ok\s/gm) ?? []).length;
  return write(chunk, ...rest);
};
process.on("exit", (code) => {
  if (code === 0 && checks === 0) {
    process.stderr.write(`FAIL no checks ran in ${process.argv[1] ?? "this test"}: a test run must pass at least one.\n`);
    process.exitCode = 1;
  }
});
