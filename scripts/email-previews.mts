// Writes every booking email (all kinds and variants, with made-up sample
// bookings) to apps/website/.email-previews/, with an index.html that shows
// them all: subject, who gets it, the email as it looks, and its plain-text
// version. Nothing is sent.
//
//   npm run email:previews
import fs from "node:fs";
import { renderEmail } from "../apps/website/server/utils/bookingEmailTemplates";
import { emailSamples } from "../supabase/tests/app/_emailSamples";

const dir = new URL("../apps/website/.email-previews/", import.meta.url);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const items = emailSamples().map((s, i) => {
  const e = renderEmail(s.kind, s.ctx);
  const file = `${String(i + 1).padStart(2, "0")}-${s.kind}${s.variant ? `--${s.variant.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : ""}.html`;
  fs.writeFileSync(new URL(file, dir), e.html);
  return { ...s, e, file, n: i + 1 };
});

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>lokl booking emails</title>
<style>
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f4f5; color: #111; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px; }
  section { background: #fff; border: 1px solid #ddd; border-radius: 8px; margin: 0 0 24px; padding: 16px; }
  h2 { font-size: 17px; margin: 0 0 4px; }
  .meta { color: #555; margin: 0 0 12px; font-size: 14px; }
  iframe { width: 100%; height: 560px; border: 1px solid #eee; border-radius: 6px; }
  details { margin-top: 8px; } pre { white-space: pre-wrap; background: #fafafa; padding: 12px; border-radius: 6px; font-size: 13px; }
  nav li { margin: 2px 0; }
</style></head><body><main>
<h1>lokl booking emails (${items.length})</h1>
<p>Sample bookings, made up. Each email as it arrives, then its plain-text version.</p>
<nav><ol>${items.map((x) => `<li><a href="#e${x.n}">${esc(x.e.subject)}</a> · ${x.kind.startsWith("customer") ? "customer" : "provider"}${x.variant ? ` · ${esc(x.variant)}` : ""}</li>`).join("")}</ol></nav>
${items.map((x) => `<section id="e${x.n}">
<h2>${x.n}. ${esc(x.e.subject)}</h2>
<p class="meta">To the ${x.kind.startsWith("customer") ? "customer" : "provider"} · <code>${x.kind}</code>${x.variant ? ` · ${esc(x.variant)}` : ""} · <a href="${x.file}">open on its own</a></p>
<iframe title="${esc(x.e.subject)}" srcdoc="${esc(x.e.html)}"></iframe>
<details><summary>Plain-text version</summary><pre>${esc(x.e.text)}</pre></details>
</section>`).join("\n")}
</main></body></html>`;
fs.writeFileSync(new URL("index.html", dir), page);
console.log(`Wrote ${items.length} emails to apps/website/.email-previews/ (open index.html).`);
