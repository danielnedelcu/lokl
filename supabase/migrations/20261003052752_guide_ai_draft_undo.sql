-- Destination guides, part 3: undoing an AI draft (decided 2026-10-03).
--
-- Each AI draft that lands replaces the guide's draft title, teaser, text
-- and listings block. The draft as it was just before is kept on that AI
-- draft's log row, so "Put back the draft from before" can restore it until
-- the next AI draft. Written only by the admin app's server (service role),
-- like the rest of guide_ai_drafts; admins read it under the existing
-- guide_ai_drafts_read_admin policy. No new grants: signed-in users still
-- can't write this table.

alter table public.guide_ai_drafts
  add column previous_draft jsonb,
  add column previous_draft_restored_at timestamptz;

comment on column public.guide_ai_drafts.previous_draft is
  'The guide''s draft just before this AI draft replaced it: title, teaser, body, area, category, kind and its review state. Null if the draft didn''t land.';
comment on column public.guide_ai_drafts.previous_draft_restored_at is
  'When the admin put the previous draft back. Set once; the previous draft can be restored only while this is the guide''s latest AI draft.';
