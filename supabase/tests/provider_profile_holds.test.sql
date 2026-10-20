-- Admin roles, step 5e (migration provider_profile_holds): support hides
-- profile content and the owner decides; hidden photos leave the public
-- bucket; support can't remove outright; a provider can't put a hidden
-- photo back by its path.
begin;
\ir _helpers/users.psql
select plan(65);

select tests.create_user('ph-owner@test.local') as owner \gset
select tests.create_user('ph-owner2@test.local') as owner2 \gset
select tests.create_user('ph-support@test.local') as sup \gset
select tests.create_user('ph-provider@test.local') as powner \gset
select tests.create_user('ph-other@test.local') as other \gset
select tests.create_user('ph-customer@test.local') as cust \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup');
select id as atl from cities where slug = 'atlanta' \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'PH Ward') returning id as area \gset
insert into categories (kind, name, slug) values ('experience', 'PH food', 'ph-food') returning id as cat \gset
insert into providers (owner_id, display_name, city_id) values (:'powner', 'PH Tours', :'atl') returning id as p \gset
update providers set headline = 'Walks with stories', bio = 'Twelve years of walking tours in Atlanta.',
  avatar_path = :'p' || '/avatar-1.webp', avatar_small_path = :'p' || '/avatar-1-small.webp',
  cover_path = :'p' || '/cover-1.webp', cover_card_path = :'p' || '/cover-1-card.webp' where id = :'p';
insert into providers (owner_id, display_name, city_id, headline) values (:'other', 'PH Others', :'atl', 'Just a headline') returning id as p2 \gset
-- Public: a live listing.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'cat', :'atl', 'PH walk', 'A walk with stories, long enough to list.', 4000, 60, :'area') returning id as l \gset
select tests.make_ready(:'l');
update listings set status = 'submitted' where id = :'l';
update listings set status = 'live', published_at = now() where id = :'l';
select version as v0 from public_content_versions where scope = 'listings' \gset

-- ---------------------------------------------------------------------------
-- 1. SUPPORT HIDES: off the profile at once, kept, logged, told
-- ---------------------------------------------------------------------------

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select is(jsonb_array_length(admin_hide_profile_content(:'sup', :'p', array['headline', 'avatar'], 'contact_details',
  'A phone number in the headline and photo.', 'Please keep contact details off your profile.')), 1,
  '1a. support hides the headline and the profile photo: one photo''s files to move');
select tests.clear_authentication();
select is((select coalesce(headline, '-') || '|' || coalesce(avatar_path, '-') || '|' || coalesce(avatar_small_path, '-') || '|' || bio from providers where id = :'p'),
  '-|-|-|Twelve years of walking tours in Atlanta.', '1b. both are off the profile at once; the bio stays');
select is((select held_text || '|' || files from provider_profile_holds where provider_id = :'p' and part = 'headline'),
  'Walks with stories|none', '1c. the headline is kept in its hold');
select is((select array_to_string(public_paths, ',') || '|' || files || '|' || (held_paths[1] = :'p' || '/' || id || '/avatar-1.webp')::text
             from provider_profile_holds where provider_id = :'p' and part = 'avatar'),
  :'p' || '/avatar-1.webp,' || :'p' || '/avatar-1-small.webp|moving|true', '1d. the photo''s two files are recorded, to move into the held bucket by hold');
select is((select action || '|' || admin_id::text || '|' || reason from admin_actions where target_id = :'p' and action = 'hide_profile_content'),
  'hide_profile_content|' || :'sup' || '|A phone number in the headline and photo.', '1e. logged: who and why');
select is((select kind || '|' || rule || '|' || array_to_string(removed, ',') || '|' || message from provider_emails where provider_id = :'p' and kind = 'provider_profile_hidden'),
  'provider_profile_hidden|contact_details|avatar,headline|Please keep contact details off your profile.', '1f. the provider''s email: what, the rule, lokl''s message');
select is((select count(*)::int from admin_notifications where kind = 'profile_hidden' and recipient_id in (:'owner', :'owner2')), 2, '1g. every owner''s bell');
select is((select count(*)::int from admin_emails where kind = 'admin_profile_hidden'), 2, '1h. ...and inbox');
select ok((select version from public_content_versions where scope = 'listings') > :v0, '1i. the public pages'' cache version rises');
select tests.authenticate_as_anon();
select is((select coalesce(headline, '-') || '|' || coalesce(avatar_path, '-') from providers where id = :'p'), '-|-', '1j. visitors see neither');
-- The provider: told which parts and the rule, never why or the hidden version.
select tests.authenticate_as(:'powner');
select is((select string_agg(e ->> 'part' || ':' || (e ->> 'rule'), ',' order by e ->> 'part') from jsonb_array_elements(my_profile_holds()) e),
  'avatar:contact_details,headline:contact_details', '1k. the provider sees what''s hidden and the rule');
select is((select count(*)::int from jsonb_array_elements(my_profile_holds()) e where e ? 'reason' or e ? 'held_text'), 0, '1l. ...never the reason or the hidden version');
select is((select count(*)::int from provider_profile_holds), 0, '1m. ...and can''t read the holds');
select throws_ok(format($$ update providers set avatar_path = %L, avatar_small_path = %L where id = %L $$, :'p' || '/avatar-1.webp', :'p' || '/avatar-1-small.webp', :'p'),
  '23514', 'That photo was hidden by lokl, so it can''t go back on your profile. Upload a new one.', '1n. ...or put the hidden photo back by its path');
select lives_ok(format($$ update providers set headline = 'Walking tours with local stories' where id = %L $$, :'p'), '1o. ...but can write a new headline');
select tests.authenticate_as(:'other');
select is(my_profile_holds(), '[]'::jsonb, '1p. another provider sees none of them');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 2. REFUSED: support never deletes; only lokl's team hides
-- ---------------------------------------------------------------------------

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_remove_provider_profile_content(%L, %L, array['bio'], 'abuse', 'Support removing outright.', null) $$, :'p', :'sup'),
  '42501', 'Removing profile content needs the owner. Hide it instead: the owner decides.', '2a. support can''t remove profile content outright');
select throws_ok(format($$ select admin_decide_profile_hold(%L, (select id from provider_profile_holds where provider_id = %L and part = 'avatar'), 'remove') $$, :'sup', :'p'),
  '42501', 'Only the owner decides on hidden profile content.', '2b. ...nor confirm a removal');
select throws_ok(format($$ select admin_decide_profile_hold(%L, (select id from provider_profile_holds where provider_id = %L and part = 'avatar'), 'restore') $$, :'sup', :'p'),
  '42501', 'Only the owner decides on hidden profile content.', '2c. ...nor restore');
select throws_ok(format($$ select admin_hide_profile_content(%L, %L, array['cover'], 'abuse', 'No cover here.') $$, :'sup', :'p2'),
  '23514', 'There''s no cover photo to hide.', '2d. only what''s there can be hidden');
select throws_ok(format($$ select admin_hide_profile_content(%L, %L, array['headline'], 'abuse', 'no') $$, :'sup', :'p2'),
  '23514', 'Say why, in a few words. It''s kept in the provider''s history.', '2e. a reason is needed');
select throws_ok(format($$ select admin_hide_profile_content(%L, %L, array['headline'], 'rude', 'An unknown rule.') $$, :'sup', :'p2'),
  '23514', 'Choose the profile rule this content breaks.', '2f. ...and one of the profile rules');
select set_config('request.headers', json_build_object('x-lokl-admin-session', gen_random_uuid())::text, true);
select throws_ok(format($$ select admin_hide_profile_content(%L, %L, array['headline'], 'abuse', 'Not on the team.') $$, :'cust', :'p2'),
  '42501', 'Only lokl''s team can hide profile content.', '2g. someone off the team can''t hide anything');
select tests.authenticate_as(:'sup', 'admin', 'aal2', :'sup_session');
select throws_ok(format($$ select admin_hide_profile_content(%L, %L, array['headline'], 'abuse', 'From the browser.') $$, :'sup', :'p2'),
  '42501', 'permission denied for function admin_hide_profile_content', '2h. never from a browser');
select throws_ok(format($$ select admin_profile_hold_files((select id from provider_profile_holds limit 1), 'private') $$),
  '42501', 'permission denied for function admin_profile_hold_files', '2i. ...nor the files'' record');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 3. THE FILES' RECORD
-- ---------------------------------------------------------------------------

select id as h_avatar from provider_profile_holds where provider_id = :'p' and part = 'avatar' \gset
select id as h_headline from provider_profile_holds where provider_id = :'p' and part = 'headline' \gset
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_profile_hold_files(%L, 'private') $$, :'h_avatar'), '3a. the server records the photo moved into the held bucket');
select throws_ok(format($$ select admin_profile_hold_files(%L, 'public') $$, :'h_avatar'), '23514', 'A hold''s files can''t go from private to public.',
  '3b. only the next step in its path');
select throws_ok(format($$ update provider_profile_holds set reason = 'Rewritten afterwards.' where id = %L $$, :'h_avatar'), '23514',
  'A hold''s record doesn''t change; only its decision and its files'' state do.', '3c. a hold''s record never changes, even for the server');
select throws_ok(format($$ delete from provider_profile_holds where id = %L $$, :'h_avatar'), '23514', 'Hidden profile content is kept: holds are never deleted.',
  '3d. ...and it''s never deleted');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 4. THE OWNER DECIDES
-- ---------------------------------------------------------------------------

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
-- The headline: the provider wrote a new one (1o), so it can't be restored over it.
select throws_ok(format($$ select admin_decide_profile_hold(%L, %L, 'restore') $$, :'owner', :'h_headline'), '23514',
  'They''ve added a new one since, so restoring would replace it. Confirm the removal, or dismiss it if the hidden version didn''t break the rule.',
  '4a. restoring over the provider''s new headline: refused');
select is(admin_decide_profile_hold(:'owner', :'h_headline', 'dismiss', 'Their new one is fine; the old one was too.'), null::jsonb,
  '4b. dismissed: the old headline didn''t break the rule and they''ve replaced it (no files)');
select tests.clear_authentication();
select is((select status || '|' || coalesce(held_text, '-') from provider_profile_holds where id = :'h_headline'), 'dismissed|-', '4c. ...the hidden version is discarded');
select is((select headline from providers where id = :'p'), 'Walking tours with local stories', '4d. ...their new headline stays');
select is((select kind from provider_emails where provider_id = :'p' and admin_action_id = (select decided_action_id from provider_profile_holds where id = :'h_headline')),
  'provider_profile_reviewed', '4e. ...and they''re told it was reviewed');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
-- The photo: the slot is still empty.
select throws_ok(format($$ select admin_decide_profile_hold(%L, %L, 'dismiss') $$, :'owner', :'h_avatar'), '23514',
  'Dismiss is only for content they''ve already replaced. If the hidden version didn''t break the rule, restore it.', '4f. dismissing one still in its slot: refused');
select is(admin_decide_profile_hold(:'owner', :'h_avatar', 'restore') ->> 'move_back', 'true', '4g. restoring the photo: the server moves its files back');
select tests.clear_authentication();
select is((select status || '|' || files from provider_profile_holds where id = :'h_avatar'), 'restored|restoring', '4h. ...restored, files on their way back');
select is((select coalesce(avatar_path, '-') from providers where id = :'p'), '-', '4i. ...and not on the profile until they''re back');
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_profile_hold_files(%L, 'public') $$, :'h_avatar'), '4j. the server records the files moved back');
select tests.clear_authentication();
select is((select avatar_path || '|' || avatar_small_path from providers where id = :'p'), :'p' || '/avatar-1.webp|' || :'p' || '/avatar-1-small.webp',
  '4k. ...and the photo is back on the profile');
select is((select kind from provider_emails where admin_action_id = (select decided_action_id from provider_profile_holds where id = :'h_avatar')),
  'provider_profile_restored', '4l. the provider is told it''s back');
-- After the restore, the provider saves their whole profile form with a new
-- cover: the restored photo's path (still recorded in its hold) goes back
-- unchanged, and that's fine.
select tests.authenticate_as(:'powner');
select lives_ok(format($$ update providers set headline = headline, bio = bio, avatar_path = %L, avatar_small_path = %L, cover_path = %L, cover_card_path = %L where id = %L $$,
  :'p' || '/avatar-1.webp', :'p' || '/avatar-1-small.webp', :'p' || '/cover-2.webp', :'p' || '/cover-2-card.webp', :'p'),
  '4l2. after a restore, the provider saves the whole form with a new cover');
select tests.clear_authentication();
select is((select cover_path || '|' || avatar_path from providers where id = :'p'), :'p' || '/cover-2.webp|' || :'p' || '/avatar-1.webp', '4l3. ...saved');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_decide_profile_hold(%L, %L, 'remove') $$, :'owner', :'h_avatar'), '55000', 'This was already decided.', '4m. decided once');
-- The owner hides the bio (no alert: they are the owners), then confirms the removal.
select is(jsonb_array_length(admin_hide_profile_content(:'owner', :'p', array['bio'], 'abuse', 'Insulting a competitor by name.')), 0, '4n. the owner hides the bio');
select tests.clear_authentication();
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id where n.kind = 'profile_hidden' and a.admin_id = :'owner'), 0,
  '4o. ...no owner is alerted about the owner');
select id as h_bio from provider_profile_holds where provider_id = :'p' and part = 'bio' \gset
select tests.authenticate_as_service_role();
select is(admin_decide_profile_hold(:'owner', :'h_bio', 'remove', 'Confirmed: it names and insults another business.'), null::jsonb, '4p. the owner confirms the removal');
select tests.clear_authentication();
select is((select status || '|' || coalesce(held_text, '-') from provider_profile_holds where id = :'h_bio'), 'removed|-', '4q. ...the hidden text is deleted');
select is((select kind || '|' || array_to_string(removed, ',') || '|' || rule from provider_emails where admin_action_id = (select decided_action_id from provider_profile_holds where id = :'h_bio')),
  'provider_profile_edited|bio|abuse', '4r. ...and the provider is told it''s removed, and why');
select is((select string_agg(action || ':' || coalesce(reason, '-'), ' / ' order by created_at)
             from admin_actions where target_id = :'p' and action in ('dismiss_profile_hold', 'restore_profile_content', 'confirm_profile_removal')),
  'dismiss_profile_hold:Their new one is fine; the old one was too. / restore_profile_content:- / confirm_profile_removal:Confirmed: it names and insults another business.',
  '4s. each decision logged, with the owner''s note');

-- ---------------------------------------------------------------------------
-- 5. THE QUEUE AND THE 7-DAY RULE
-- ---------------------------------------------------------------------------

select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select is(jsonb_array_length(admin_hide_profile_content(:'sup', :'p', array['cover'], 'unsuitable_photo', 'A stock photo of another city.')), 1, '5a. support hides the cover');
select is(jsonb_array_length(admin_hide_profile_content(:'sup', :'p2', array['headline'], 'impersonation', 'Claims an award they don''t have.')), 0, '5b. ...and another provider''s headline');
select tests.clear_authentication();
-- The cover is hidden: its path can't be written back, though the form
-- re-sending the unchanged avatar path still saves.
select tests.authenticate_as(:'powner');
select throws_ok(format($$ update providers set avatar_path = %L, avatar_small_path = %L, cover_path = %L, cover_card_path = %L where id = %L $$,
  :'p' || '/avatar-1.webp', :'p' || '/avatar-1-small.webp', :'p' || '/cover-2.webp', :'p' || '/cover-2-card.webp', :'p'),
  '23514', 'That photo was hidden by lokl, so it can''t go back on your profile. Upload a new one.', '5b2. a hidden cover still can''t be written back');
select lives_ok(format($$ update providers set headline = 'Walking tours, told well', avatar_path = %L, avatar_small_path = %L where id = %L $$,
  :'p' || '/avatar-1.webp', :'p' || '/avatar-1-small.webp', :'p'), '5b3. ...while saving the rest of the form, unchanged photo included, works');
select tests.clear_authentication();
-- The cover was hidden 8 days ago (backdated with triggers off, as the test runner).
set local session_replication_role = replica;
update provider_profile_holds set hidden_at = now() - interval '8 days' where provider_id = :'p' and part = 'cover';
set local session_replication_role = origin;
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((select (r ->> 'part') || '|' || (r ->> 'overdue') || '|' || (r ->> 'status') from jsonb_array_elements(admin_profile_holds_page() -> 'rows') with ordinality t(r, n) where n = 1),
  'cover|true|hidden', '5c. waiting over 7 days: first in the owner''s queue, and still hidden');
select is((admin_profile_holds_page() ->> 'total')::int, 2, '5d. the owner sees every open hold');
select is((admin_profile_holds_page('decided') ->> 'total')::int, 3, '5e. ...and the decided ones');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((admin_profile_holds_page('decided') ->> 'total')::int, 2, '5f. support sees the ones they made (the headline and photo, not the owner''s bio)');
select is((admin_profile_holds_page('all', p_provider_id := :'p') ->> 'total')::int, (select count(*)::int from provider_profile_holds where provider_id = :'p'),
  '5f2. ...and every one of a provider''s on that provider''s page, the owner''s included');
select tests.authenticate_as(:'cust', null, 'aal2', null);
select throws_ok($$ select admin_profile_holds_page() $$, '42501', 'Only lokl''s team can see hidden profile content.', '5g. not a customer');
select tests.clear_authentication();
select is((select status from provider_profile_holds where provider_id = :'p' and part = 'cover'), 'hidden', '5h. a week on, it''s never deleted on its own');

-- ---------------------------------------------------------------------------
-- 6. STORAGE: THE HELD BUCKET IS PRIVATE; DELETING PHOTOS IS THE OWNER'S
-- ---------------------------------------------------------------------------

select is((select public from storage.buckets where id = 'provider-photos-held'), false, '6a. the held bucket has no public addresses');
select is((select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and (qual like '%provider-photos-held%' or with_check like '%provider-photos-held%')),
  'provider_photos_held_read_admin:SELECT', '6b. ...only the team may read it; nobody but the server writes or deletes there');
select is((select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and cmd = 'DELETE' and qual like '%''provider-photos''%' and qual like '%is_admin%'), null,
  '6c. no rule lets every admin delete a provider''s photo files any more');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'provider_photos_objects_delete_owner' and qual like '%is_owner%'), 1, '6d. ...the owner may');

select * from finish();
rollback;
