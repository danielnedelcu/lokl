# Sign in with a code, without leaving the page

Status: **built** (2026-10-04), as approved, with the recommendation on all
five open questions (see Decisions; As built).

## What changes

Today every sign-in leaves the page: "Sign in to book" and a signed-out
heart send the visitor to `/login`, an emailed link brings them back through
`/confirm`, and the link only works in the browser that asked for it.

After this change:

1. A **sign-in dialog** asks for an email address, on the page they're on.
2. lokl emails a **6-digit code** (and, as now, a link).
3. They type the code **in the same dialog** and are signed in where they
   are: the date they picked, or the heart they tapped, is still there.
4. The **link** still works for people who prefer it, as it does today
   (same browser, back to the page through `/confirm`).

One sign-in form, used everywhere:

| Where | Today | After |
| --- | --- | --- |
| "Sign in to book" (listing page) | goes to `/login` | opens the dialog; signed in, the booking form takes the button's place (dates are picked after signing in, so nothing is lost) |
| A heart, signed out | dialog, then `/login` | the dialog; signed in, the item is saved at once ("Saved …") |
| Header "Sign in" | goes to `/login` | opens the dialog (open question 1) |
| `/login` (and pages that need sign-in, which redirect there) | link only | the same form in the page's card; signed in, it goes where it would have (the saved address, else `/dashboard`) |
| Admin app `/login` | link only | the same form (no sign-up), since one email template serves both apps (open question 4) |

## The form (both steps)

One shared component, `SignInForm` (in `packages/ui`, so the admin app uses
it too), and a website `SignInDialog` around it, opened from anywhere with
`useSignIn().open({ title, then })`. It replaces `SaveSignInDialog`.

**Step 1, email.** "Email" field (`type="email"`, `autocomplete="email"`),
then **Send me a code**. The dialog's title says why: "Sign in to save
Sweet Auburn Food Walk", "Sign in to book", or "Sign in or sign up". The
website creates the account on first sign-in, as now; the admin app never
does.

**Step 2, code.**

- Text: "We sent a 6-digit code to **you@example.com**. It works for 10
  minutes." with **Use a different email** (back to step 1).
- **One field**, not six boxes: one label, works with paste, password
  managers and the phone's suggested code, and screen readers read it as one
  field.
  - Visible label: "6-digit code".
  - `autocomplete="one-time-code"`, `inputmode="numeric"`,
    `pattern="[0-9]*"`, `maxlength` 6 after cleaning; spaces and dashes in a
    pasted code are ignored.
  - Large, spaced digits; focus moves to it when the step opens.
  - Errors are linked with `aria-describedby` and announced (`role="alert"`).
- **Sign in** button; Enter submits. It doesn't submit by itself at the
  sixth digit: changing what's on screen while someone types is
  disorienting with a screen reader (WCAG 3.2.2), and a wrong last digit
  would cost an attempt.
- **Resend** ("Send a new code"): disabled for 60 seconds after each send,
  with the time left in its text ("Send a new code in 42 s"; announced only
  when it becomes available, not every second). A new code replaces the old
  one; the old one stops working.
- The link in the same email still works meanwhile.

**After signing in**, the dialog closes, focus returns to the button that
opened it (the heart, or "Sign in to book"), a toast says "Signed in as
you@example.com", and the page's signed-in parts refresh in place (the
account menu, the booking panel, the hearts). No page load.

## Messages

Supabase answers a wrong code and an expired code with the same error
(`otp_expired`, "Token has expired or is invalid"), so the form tells them
apart by when the code was sent.

| When | Message |
| --- | --- |
| Code not 6 digits | "Enter the 6-digit code from the email." (no request sent) |
| Wrong code (sent under 10 minutes ago) | "That code isn't right. Check the email and try again." plus the tries left, from the third wrong one: "2 tries left." |
| Expired (sent 10 or more minutes ago) | "This code has expired. Send a new code." (no request sent) |
| 5 wrong codes for this code | Field disabled: "That's 5 wrong codes. Send a new code to try again." |
| Supabase's verify limit (HTTP 429) | "Too many tries from this device. Wait a few minutes, then try again." |
| Sending too soon (Supabase's per-address limit) | "You can ask for a new code in 42 seconds." (the seconds from Supabase's answer) |
| Email not sent (other errors, offline) | "We couldn't send the code. Check your connection and try again." |
| Admin app, any failure to send (including an address with no login) | "We couldn't send a sign-in code. Check this is an admin's email address, or try again in a minute." (today's wording: it doesn't reveal which addresses have a login) |

## Attempt limits, honestly

The browser's limit (5 wrong codes, then a new code) is for people, not
attackers: anyone can call Supabase's verify endpoint directly with the
public key, so a limit in our code can't stop a guesser. What does:

- **The code's life:** 10 minutes, and a new code replaces the old one.
- **Supabase's verify rate limit:** 30 verifications per 5 minutes per IP
  address (Authentication → Rate Limits, "Token verifications"; the default,
  and the local stack's setting). One address can make at most about 60
  guesses in a code's life, about a 1 in 17,000 chance against a
  1,000,000-code space.
- **Supabase's send limits:** one code per address per 60 seconds, and the
  project's hourly email limit.

Not covered: many addresses guessing at once. If that's ever a concern,
the next steps are a CAPTCHA on sending (Supabase supports Turnstile) or 8
digits; added to the TODO, not built now.

## The email (Supabase templates)

Supabase sends the **Magic link** template for sign-in, and the **Confirm
signup** template the first time an address signs in, if email
confirmations are on. Both get the same body, so the code is there either
way. I'll confirm in the local mailbox which one a new address gets.

**Subject:** `Your lokl sign-in code` (the code isn't in the subject, so it
doesn't show on a locked phone's screen).

**Body** (plain HTML, matching the booking emails' style):

> **Your sign-in code**
>
> **{{ .Token }}** (large, spaced)
>
> Enter this code on lokl to sign in. It works for 10 minutes.
>
> Or sign in with this link, in the browser where you asked for the code:
> [Sign in to lokl]({{ .ConfirmationURL }})
>
> If you didn't ask to sign in, you can ignore this email.

**Local stack:** the templates live in `supabase/templates/` and are
wired up in `supabase/config.toml` (`[auth.email.template.magic_link]` and
`.confirmation`), with `otp_expiry = 600`. The local hourly email limit goes
from 10 to 100, since the tests now send several codes per run (local only).

**What you'll change in the Supabase dashboard** (hosted project; I'll give
you the final HTML to paste once it's built and checked in Mailpit):

1. Authentication → Emails → Templates → **Magic link**: subject and body
   as above.
2. The same for **Confirm signup**.
3. Authentication → Sign In / Providers → Email: **Email OTP length 6**,
   **Email OTP expiration 600** seconds. (This also shortens the link's
   life from an hour to 10 minutes; they share the setting.)
4. Authentication → Rate Limits: check "Token verifications" is 30 per 5
   minutes (the default).

The new template works with the current site too (the link is unchanged),
so the dashboard can change before or after the code ships.

## Building it

1. Templates and local config; check both emails in Mailpit.
2. `SignInForm` (packages/ui), `useSignIn()` and `SignInDialog` (website),
   `signInMessages` (the table above, as a tested function).
3. Use it: the heart (replaces the dialog-then-`/login` step; the intent
   cookie stays for the link path), "Sign in to book", the header, the
   website and admin `/login` pages.
4. Docs: this design marked built, decisions, TODO (CAPTCHA/8 digits later).

**Tests:**

- `signInMessages`: wrong vs expired by time, tries left, rate-limit
  seconds parsed (UI test, `test:ui`).
- End-to-end, reading the code from Mailpit:
  - Journey 5, rewritten: "Sign in to book" → dialog → code from Mailpit →
    still on the listing, signed in, "Continue to payment" shown, the
    chosen date kept. A second test keeps the link path: `/login`, the
    emailed link, back where they were.
  - Journey 9: the signed-out heart, by code, saved without leaving the
    page. The link path with the intent cookie stays tested.
  - Wrong code (message, tries left), 5 wrong codes (field disabled),
    resend (countdown; the old code refused, the new one works), expired
    (the browser's clock moved past 10 minutes), Supabase's 429 (made in
    the test), keyboard and labels (the field's name, `autocomplete`,
    focus moving to it and back to the opener).
  - The admin app signs in by code.
- Deliberate breaks: treat every error as "expired", don't disable after 5,
  don't return focus.

## Decisions (2026-10-04)

1. The header's **Sign in opens the dialog** in place.
2. Codes and links last **10 minutes**.
3. The code stays **out of the subject**.
4. The **admin app** signs in by code too.
5. The email step says **"New to lokl? This creates your account."**
   (website only; the admin app never creates accounts).

Later (docs/TODO.md, Launch prep, Sign-in): a second factor for admins, and
the terms line in the dialog once the terms exist.

## As built (2026-10-04)

- `SignInForm` and `signInMessages` (packages/ui); `useSignIn()` and
  `SignInDialog` (website, in `app.vue`, browser only; it replaced
  `SaveSignInDialog` and still holds the hearts' live region).
- The hearts and the link path share one way back: sending a code from a
  heart's dialog writes the 30-minute intent cookie, and whichever way they
  sign in (code here, or link back to the page), the hearts' reload saves it
  once. The cookie is read straight from `document.cookie`, since the code
  sign-in reads it moments after it was written.
- The provider record on public pages (`useOwnProvider`) loads when someone
  signs in on the page, so "Dashboard" in the menu and "This is your
  listing" appear without a reload.
- Focus after signing in goes back to the opener, or its stand-in when the
  opener is gone: the account menu (header) or the booking panel's price
  ("Sign in to book"), placed after the page has redrawn.
- Supabase reports the last second of its send limit as "after 0 seconds";
  the form says "1 second". The local stack's limit between sends is 1
  second (`max_frequency`); the hosted one is 60.
- `/confirm` (both apps): an expired or wrong-browser link now says to sign
  in again, for a new code that works in this browser.
- One template file, `supabase/templates/sign-in.html`, for Magic link and
  Confirm signup; the local stack's hourly email limit is 100.
- Tests: `signInMessages` (UI test, 16 checks); end-to-end journey 5
  (code; link), journey 9 (the heart by code; by link) and journey 10
  (labels and focus, wrong codes and the lock, resend, expiry, Supabase's
  429, the admin app). Deliberate breaks caught: never locking, no focus
  return, every refusal read as expired.

## Open questions (resolved: see Decisions)

1. **Header "Sign in":** open the dialog in place (recommended, it's the
   point of the change), or keep it going to `/login`?
2. **Code life:** 10 minutes for code and link (recommended), or keep an
   hour? Shorter is safer for a 6-digit code; the link shares it.
3. **The code in the subject:** leave it out (recommended, it shows on
   locked screens), or include it for speed?
4. **Admin app:** use the same code form (recommended: the shared email
   will show a code either way), or keep the admin on links only?
5. **Wording for a first sign-in:** the dialog says "Sign in or sign up"
   on the header and `/login`, and "Sign in to …" elsewhere, with a line
   under the email field: "New to lokl? This creates your account."
   (recommended), or no mention?
