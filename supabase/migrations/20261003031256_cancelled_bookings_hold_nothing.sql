-- A booking cancelled with a full refund has no payout to hold.
--
-- Found 2026-10-03: resolving a no-show report with a refund cancelled and
-- refunded the booking but left its payout hold ("a reported no-show"), so
-- the admin's Bookings & payouts still showed it as held. The same would
-- happen to any held booking lokl cancels. The provider is never paid for a
-- booking cancelled with a full refund, so any hold on it is cleared, by the
-- database, whichever route cancels it.
--
-- No access changes: the trigger runs as the change's own role (only the
-- server changes bookings) and touches only booking_finances. Delete
-- behaviour is unchanged.

create or replace function public.bookings_clear_hold_when_refunded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.booking_finances
     set payout_hold = null, payout_held_at = null
   where booking_id = new.id and payout_hold is not null;
  return null;
end;
$$;
comment on function public.bookings_clear_hold_when_refunded() is
  'Trigger function: clears the payout hold of a booking cancelled with a full refund (there''s no payout left to hold).';

create trigger bookings_clear_hold_when_refunded
  after update of status, refunded_cents on public.bookings
  for each row when (new.status = 'cancelled' and new.refunded_cents >= new.total_cents)
  execute function public.bookings_clear_hold_when_refunded();

-- Bookings already in that state (one on the hosted database: a report
-- resolved with a refund).
update public.booking_finances f
   set payout_hold = null, payout_held_at = null
  from public.bookings b
 where b.id = f.booking_id and b.status = 'cancelled' and b.refunded_cents >= b.total_cents and f.payout_hold is not null;
