// Sends one of every booking email (sample bookings, made up) to Resend's
// test inbox, delivered@resend.dev, to check Resend accepts each one. Uses
// NUXT_RESEND_API_KEY from apps/website/.env (read, never printed).
//
//   npm run email:test-send
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { renderEmail } from "../apps/website/server/utils/bookingEmailTemplates";
import { resendMailer } from "../apps/website/server/utils/bookingEmails";
import { emailSamples } from "../supabase/tests/app/_emailSamples";

const envFile = new URL("../apps/website/.env", import.meta.url);
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const key = env.NUXT_RESEND_API_KEY ?? "";
if (!/^re_[A-Za-z0-9_]+$/.test(key)) {
  console.error("NUXT_RESEND_API_KEY isn't set in apps/website/.env (or isn't a Resend key). Add the booking emails key first.");
  process.exit(1);
}
const mailer = resendMailer(key);
const run = randomBytes(4).toString("hex");
let failed = 0;
for (const [i, s] of emailSamples().entries()) {
  const e = renderEmail(s.kind, s.ctx);
  try {
    const { id } = await mailer.send({
      ...e, to: "delivered@resend.dev", from: env.NUXT_EMAIL_FROM || "lokl <lokl@innatetheory.com>",
      replyTo: env.NUXT_EMAIL_REPLY_TO || "delivered@resend.dev", idempotencyKey: `email-test-send-${run}-${i}`,
    });
    console.log(`ok   ${s.kind}${s.variant ? ` (${s.variant})` : ""}: accepted (${id})`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${s.kind}${s.variant ? ` (${s.variant})` : ""}: ${(err as Error).message}`);
  }
}
console.log(failed ? `${failed} failed` : "Resend accepted every booking email.");
process.exit(failed ? 1 : 0);
