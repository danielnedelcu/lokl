import { expect, type Locator, type Page } from "@playwright/test";

// The sign-in email, from the local stack's Mailpit (nothing is really
// sent). Each has the 6-digit code and the link
// (supabase/templates/sign-in.html).

export interface SignInEmail {
  id: string;
  code: string;
  link: string;
}

/** The newest sign-in email to this address; `after` waits for one newer than that. */
export async function signInEmail(mailpitUrl: string, to: string, after?: SignInEmail): Promise<SignInEmail> {
  const mailpit = mailpitUrl.replace(/\/$/, "");
  let id = "";
  await expect.poll(async () => {
    const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    id = ((await res.json()) as { messages?: { ID: string }[] }).messages?.[0]?.ID ?? "";
    return id && id !== after?.id ? id : "";
  }, { message: `a sign-in email to ${to} arrives`, timeout: 20_000 }).not.toBe("");
  const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
  const body = `${message.Text ?? ""} ${message.HTML ?? ""}`;
  const code = body.match(/>\s*(\d{6})\s*</)?.[1] ?? body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const link = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/)?.[0]?.replaceAll("&amp;", "&") ?? "";
  expect(code, "the email has a 6-digit code").toMatch(/^\d{6}$/);
  expect(link, "the email has a sign-in link").toBeTruthy();
  return { id, code, link };
}

/** A 6-digit code that isn't this one. */
export const wrongCode = (code: string) => (code === "111111" ? "222222" : "111111");

/** The six code boxes (a group named "6-digit code"), in order. */
export const codeBoxes = (scope: Page | Locator) => scope.getByRole("group", { name: "6-digit code" }).getByRole("textbox");

/** Types a code from the first box, one key at a time, as a person would. */
export async function typeCode(page: Page, scope: Page | Locator, code: string) {
  await codeBoxes(scope).first().click();
  await page.keyboard.type(code);
}

/** Pastes text into the first box (a real paste event, as from the clipboard). */
export async function pasteCode(scope: Page | Locator, text: string) {
  await codeBoxes(scope).first().evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
