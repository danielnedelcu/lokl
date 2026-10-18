# The public website's pages: footer, Help centre, policies

Status: **approved plan** (2026-10-17). Build order:
1. Nothing loaded from other sites (done 2026-10-17).
2. Google Analytics (done 2026-10-17).
3. The Markdown setup, search and the first Help articles (done 2026-10-17).
4. The information pages (done 2026-10-18; migration `commission_rates_public`).
4. The policy and information pages.
5. The legal drafts and the footer.

The migration limiting providers' access to customers' contact details is
shown separately.

Every page is written from lokl's own code and practice, in plain language.
It makes no claim about safety checks, insurance or response times that
isn't true. Each legal page says "Draft: to be reviewed by a lawyer before
launch".

## Decisions (owner, 2026-10-17)

- **Commission:** published on the hosts' Fees page: 12% on Services, 20%
  on Experiences.
- **Support address:** `help@hilokl.com`, on a business mailbox for
  hilokl.com, not a forward to a personal Gmail (launch checklist).
- **Legal entity:** not formed yet. The drafts use clear placeholders,
  "[lokl's legal name]" and "[address]", tracked in docs/TODO.md.
- **18 and over:** in the sign-in line, "By continuing, you confirm you're
  18 or over and agree to lokl's Terms and Privacy Policy", linking both.
  Every booking needs an account, so there's no separate line at checkout.
- **Providers' access to customers' details:** email, phone and address
  only until 30 days after the booking ends. They keep the name and the
  booking; admins keep access. This is a migration of its own, with tests.
- **Retention:** the privacy draft proposes periods for the lawyer and
  accountant to set, never "forever" for personal details.
- **Google Analytics:** measurement only (docs/decisions.md, 2026-10-17).

## Footer

Four columns. A link appears only once its page exists.

| lokl | Customers | Hosts | Support |
| --- | --- | --- | --- |
| About | Browse Experiences | How hosting works | Help centre |
| How lokl works | Browse Services | Fees and payouts | Contact |
| Atlanta guides | Cancellation policy | Start hosting | Safety |
| Accessibility | Review rules | Help for hosts | Terms · Privacy |

New pages:
- `/about`, `/how-lokl-works`, `/hosting`, `/fees`, `/contact`
- `/safety`, `/cancellation-policy`
- `/terms`, `/terms/hosts`, `/privacy`
- `/accessibility`
- `/help` and its articles

## Help centre

- **Format:** Markdown files in the repo (`apps/website/content/help/`).
  Each is grouped for customers or hosts, with numbered steps.
- **Facts from the code:** numbers such as 48 hours or 14 days come from
  the shared code through placeholders, so an article can't drift.
- **Search:** in the browser, with no outside service.
- **First articles:**
  - For customers: booking an Experience; booking a Service (Instant
    versus Approve); cancellations and refunds; signing in with a code or
    with Google; saving listings; leaving a review.
  - For hosts: setting up your business; connecting Stripe and getting
    paid; creating a listing; setting your availability; scheduling
    Experience sessions; accepting or declining requests; when payouts
    arrive; replying to reviews; reporting a problem.

## Privacy policy: the analytics section (lokl's own words)

> **How we measure the site.** We use Google Analytics to understand how
> people find and use lokl: which public pages are viewed, what people
> search for (the area, dates and kind of listing, never anything typed),
> which listings are opened, and how many people start and finish a
> booking. Google Analytics sets cookies (`_ga` and `_ga_…`) that last
> about two months, and Google keeps this data for two months.
>
> We don't send Google your name, email address, phone number, address,
> messages, or anything that identifies a booking. We never measure your
> account or dashboard pages, or the sign-in pages. Google's advertising
> features (Google Signals and ads personalisation) are off.
>
> **Turning it off.** If your browser sends a Global Privacy Control
> signal, we don't load Google Analytics at all. You can also install
> Google's opt-out add-on: https://tools.google.com/dlpage/gaoptout.
>
> *For the lawyer to decide:* whether a cookie notice, consent or an
> opt-out choice on the site is needed, and whether this counts as
> "sharing" under any state's privacy law.

Google Analytics also joins the list of service providers. The "Cookies"
and "Do Not Track and Global Privacy Control" sections say the same as
above.
