# Questions for the lawyer and the accountant

One list to take to them. Each answer goes into the page it names, and
its `LAUNCH-PLACEHOLDER` marker comes off with it (a deployable build fails
while any remain). Record each settled answer in `docs/decisions.md`.

The pages are drafts in `apps/website/content/pages/`: `privacy.md`
(`/privacy`), `terms.md` (`/terms`) and `terms-hosts.md` (`/terms/hosts`).
How deletion works is in `docs/design/account-deletion.md`.

## Retention periods (accountant and lawyer)

Privacy Policy, "How long we keep it". Proposed today:

| Records | Proposed period | Question |
| --- | --- | --- |
| Booking and payment records | 7 years after the booking | Is 7 years right for tax and accounting, and from which date (the booking, the payout, the end of the tax year)? |
| A booking's contact details and address | 2 years after the booking | Long enough for disputes and chargebacks? |
| Messages and problem reports | 2 years after they're closed | Right? |
| Notes about health or access needs (in a booking's notes) | Removed with the contact details, 2 years after the booking, or sooner (new: the section doesn't cover them today) | Should it be sooner, for example once the booking has ended? |
| Google Analytics | 2 months | Fine as is? |
| Supabase's sign-in log (holds email addresses) | 90 days (new) | Acceptable? |
| A closed account's de-identified business record | Until its bookings' period ends (new) | Acceptable? |
| A removed provider's keyed email hash | Not yet proposed (new) | How long may it be kept? |
| Backups | The hosting plan's backup window (new; confirmed at hosting) | See Backups, below |

## What each section of the Privacy Policy will need

For the lawyer to review once the answers below are settled:

- **"How long we keep it":**
  - the notes about health or access needs, which it doesn't mention
    today (proposed: removed with the contact details, 2 years after the
    booking, or sooner);
  - the new items: Supabase's sign-in logs, closed accounts' de-identified
    records, the removed provider's keyed email hash (if kept), and
    backups;
  - the periods in the table above, once confirmed.
- **"Your account"** (in "How long we keep it") and **"Your choices and
  rights":** the deletion process once decided: how to ask, the emailed
  code, the 7-day grace period, what's deleted, what's kept and why, and
  what has to happen first.
- **Reviews:** a review is deleted with the reviewer's account (today it
  says only "while they're published").
- **"Who sees what":** lokl's team sees a customer's or host's contact
  details only when needed, and every view is recorded (today it says the
  team "can see bookings, messages and reports").
- **"Companies that help us run lokl":** what Stripe and Resend keep after
  an account is deleted (see Processors, below).

## Deletion (lawyer)

What the policy will say about deleting an account:

- **How to ask:** on the website, or by email to support.
- **Proving it's them:** a fresh code emailed to the account's address.
  Is that enough verification, for each privacy law that applies?
- **Grace period:** 7 days, with the account frozen meanwhile; the person
  can keep it by signing in. Acceptable, and within any deadline for
  answering a request?
- **What's kept, and why:** booking and payment records, de-identified,
  for tax, disputes and chargebacks.
- **What has to happen first:** upcoming bookings cancelled, payouts due
  paid, open reports closed. May lokl ask that first?
- **What "deleted" means for processors and backups** (below).

## Reviews (lawyer)

- A deleted customer's reviews are **deleted**, with the provider's
  replies, and the provider's rating changes. Any issue with that (for
  example under the FTC's rules on reviews)?
- A closed provider's reviews are kept, unpublished, for the retention
  period. Acceptable?

## The removed provider's email (lawyer)

- When a provider removed for breaking the rules deletes their login, lokl
  plans to keep a **keyed hash** of their email (an HMAC with a secret
  only lokl holds), so they can't sign up again with the same address.
- It's still personal data. May lokl keep it, on what basis, for how long,
  and what must the policy say about it?

## Processors' own copies (lawyer)

- **Stripe** keeps payment records (with the email given at checkout) and
  hosts' identity and bank records it's required to keep, under its own
  policy. lokl deletes a host's Stripe account once its balance is zero.
- **Resend** keeps its logs of the emails it sent, with each recipient's
  address, for its plan's window.
- **Supabase** holds lokl's data. **Google** holds what it needs for
  Continue with Google, and the Analytics data.
- How should the policy describe these copies, and are data processing
  agreements needed with each before launch?

## Backups (lawyer)

- Deleted data stays in Supabase's backups until they expire. The window
  depends on the plan chosen at hosting (still to confirm). What must the
  policy say?

## Notes about access or health needs (lawyer)

- The booking form lets customers write notes for the host, and the policy
  says: "If you choose to share something about your health or access
  needs, we use it only for that booking."
- Those notes are deleted with the account, and within the contact-details
  period otherwise. Is the wording right, and does lokl need anything more
  (consent, a warning on the form, a shorter period) for health details
  under any state law?

## Already open in the drafts

These were marked when the drafts were written (2026-10-18), and belong
on the same list:

- **Privacy Policy:** which state privacy laws apply; the time to answer
  requests; how people verify who they are; whether a cookie notice,
  consent or opt-out is needed, and whether Google Analytics counts as
  "sharing" under any state's law.
- **Terms of Use:** what lokl is and isn't responsible for, limits of
  liability, disclaimers, how disputes are resolved, governing law.
- **Terms for hosts:** limits of liability, indemnity, how disputes
  between lokl and hosts are resolved, governing law; Stripe's Connected
  Account Agreement wording.
- **Accountant:** tax forms (1099-K), tax wording, and what happens to a
  payment when a dispute is lost.
- **Everywhere:** lokl's legal name, address and hosting provider.
