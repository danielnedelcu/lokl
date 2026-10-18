---
title: When payouts arrive
summary: Your share is sent {{PAYOUT_AFTER_END}} after a booking ends, then reaches your bank on Stripe's schedule.
order: 7
updated: 2026-10-17
---
## What you receive

You receive the price of the booking, minus lokl's commission. The amount is shown on each booking. Customers pay the listed price: there are no fees added on their side.

## When it's sent

1. The booking takes place.
2. {{PAYOUT_AFTER_END}} after it ends, lokl sends your share to your Stripe account. We email you.
3. Stripe pays it into your bank account on its own schedule. Choose **View payouts in Stripe** on your **Payouts** page to see when.

## When a payout waits

A payout waits while lokl looks into something:

- the customer reported that you didn't show up;
- the customer disputed the payment with their bank;
- the booking was refunded;
- your account is paused;
- your Stripe account can't receive money yet.

If lokl gives the customer a full refund after a report, you aren't paid for that booking.

## Cancellations

- If a customer cancels less than {{CANCEL_FREE_BEFORE}} before the start, you're still paid, unless they cancel within {{CANCEL_GRACE}} of booking.
- If you cancel, the customer gets a full refund and you aren't paid.
