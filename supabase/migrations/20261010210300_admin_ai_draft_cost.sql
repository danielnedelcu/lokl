-- The admin's AI drafting cost this month, added up by the database
-- (truncation sweep, 2026-10-10). The page read the month's drafts and
-- added them up in the browser, so past 1,000 drafts the cost shown was too
-- low.
--
-- Security invoker: only admins can read guide_ai_drafts, so anyone else
-- gets zero.

create function public.admin_ai_draft_cost(p_since timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('count', count(*)::int, 'cost_usd', coalesce(sum(d.cost_usd), 0))
  from public.guide_ai_drafts d
  where d.created_at >= p_since;
$$;

comment on function public.admin_ai_draft_cost(timestamptz) is
  'How many AI drafts were made since a time, and what they cost (US dollars). Runs with the caller''s read rules (admins read the drafts). Called by the admin app''s Content page (signed-in admins).';

revoke execute on function public.admin_ai_draft_cost(timestamptz) from public, anon, service_role;
grant execute on function public.admin_ai_draft_cost(timestamptz) to authenticated;
