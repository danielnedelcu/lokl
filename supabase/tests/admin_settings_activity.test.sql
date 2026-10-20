-- Admin roles, step 5d (migration admin_settings_activity): listing
-- readiness from one source and enforced on the move into live or review,
-- listing review in the database (logged; support taking one down alerts
-- the owners), the owner's settings, the new logs, and the Activity page.
begin;
\ir _helpers/users.psql
select plan(73);

select tests.create_user('sa-owner@test.local') as owner \gset
select tests.create_user('sa-owner2@test.local') as owner2 \gset
select tests.create_user('sa-support@test.local') as sup \gset
select tests.create_user('sa-provider@test.local') as powner \gset
select tests.create_user('sa-other@test.local') as other \gset
select tests.create_user('sa-customer@test.local') as cust \gset
select tests.make_admin(:'owner') as owner_session \gset
select tests.make_admin(:'owner2') as owner2_session \gset
select tests.make_admin(:'sup', 'support') as sup_session \gset
update admin_members set status = 'removed', removed_at = now()
 where status <> 'removed' and user_id not in (:'owner', :'owner2', :'sup');
select id as atl from cities where slug = 'atlanta' \gset
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'SA Ward') returning id as area \gset
insert into categories (kind, name, slug) values ('experience', 'SA food', 'sa-food') returning id as exp \gset
insert into categories (kind, name, slug) values ('service', 'SA cuts', 'sa-cuts') returning id as svc \gset
insert into providers (owner_id, display_name, city_id) values (:'powner', 'SA Tours', :'atl') returning id as p \gset
insert into providers (owner_id, display_name, city_id) values (:'other', 'SA Others', :'atl') returning id as p2 \gset

-- An Experience, a Service at the provider's place, and one that travels: all drafts.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'SA crawl', 'Four taquerias on the BeltLine, with stories.', 6500, 60, :'area')
returning id as le \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, area_id, booking_mode, duration_minutes)
values (:'p', 'service', :'svc', :'atl', 'SA studio cut', 'A classic cut, with a wash and style.', 4500, 'provider_location', :'area', 'instant', 60)
returning id as lsp \gset
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, location_mode, booking_mode, duration_minutes)
values (:'p', 'service', :'svc', :'atl', 'SA home cut', 'A classic cut wherever you are.', 8000, 'customer_location', 'instant', 60)
returning id as lsc \gset

-- ---------------------------------------------------------------------------
-- 1. LISTING READINESS: one source, for both kinds
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'powner');
select is((select string_agg(i ->> 'key', ',' order by n) from jsonb_array_elements(listing_readiness(:'le')) with ordinality t(i, n)),
  'account,photos,address,sessions,payouts', '1a. an Experience: account, photos, the meeting address, sessions, payouts, in that order');
select is((select string_agg(i ->> 'key', ',' order by n) from jsonb_array_elements(listing_readiness(:'lsp')) with ordinality t(i, n)),
  'account,photos,address,payouts', '1b. a Service at the provider''s place: an address, no travel areas or sessions');
select is((select string_agg(i ->> 'key', ',' order by n) from jsonb_array_elements(listing_readiness(:'lsc')) with ordinality t(i, n)),
  'account,photos,travel_areas,payouts', '1c. a Service that travels: travel areas, no address');
select is((select string_agg((i ->> 'done') || '/' || (i ->> 'blocks_live') || '/' || (i ->> 'blocks_submit'), ',' order by n)
             from jsonb_array_elements(listing_readiness(:'le')) with ordinality t(i, n)),
  'true/true/true,false/true/true,false/true/true,false/false/false,false/true/false',
  '1d. ...done and blocking: sessions never block; payouts block going live, not review');
select is((select i ->> 'label' from jsonb_array_elements(listing_readiness(:'le')) i where i ->> 'key' = 'payouts'),
  'Set up payouts (needed before we can approve it)', '1e. ...in the checklist''s words, for the kind');
select is((select i ->> 'label' from jsonb_array_elements(listing_readiness(:'lsp')) i where i ->> 'key' = 'address'),
  'Add your address', '1f. ...a Service''s address in its own words');
select tests.authenticate_as(:'other');
select throws_ok(format($$ select listing_readiness(%L) $$, :'le'), 'P0002', 'We couldn''t find that listing.', '1g. another provider can''t read it');
select tests.authenticate_as_anon();
select throws_ok(format($$ select listing_readiness(%L) $$, :'le'), '42501', NULL, '1h. nor a visitor');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is(jsonb_array_length(listing_readiness(:'le')), 5, '1i. the team reads it');
select tests.authenticate_as_service_role();
select is(jsonb_array_length(listing_readiness(:'le')), 5, '1j. ...and the server');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 2. THE RULE, ENFORCED ON THE MOVE INTO REVIEW OR LIVE
-- ---------------------------------------------------------------------------

select throws_ok(format($$ update listings set status = 'submitted' where id = %L $$, :'le'), '23514',
  'Before it can be sent for review: add at least one photo; add the meeting address.', '2a. sent for review with nothing: refused, naming each missing item');
insert into listing_photos (listing_id, storage_path, position, alt_text)
values (:'le', :'p' || '/' || :'le' || '/' || gen_random_uuid() || '.jpg', 0, 'A photo');
insert into listing_addresses (listing_id, line1, city, state, postal_code) values (:'le', '1 Trail Way', 'Atlanta', 'GA', '30312');
select lives_ok(format($$ update listings set status = 'submitted' where id = %L $$, :'le'), '2b. with a photo and the address, it goes for review without payouts or sessions');
select throws_ok(format($$ update listings set status = 'live' where id = %L $$, :'le'), '23514',
  'Before it can go live: set up payouts (needed before we can approve it).', '2c. ...but can''t go live until payouts are set up');
select throws_ok(format($$ update listings set status = 'live' where id = %L $$, :'lsc'), '23514',
  'Before it can go live: add at least one photo; choose at least one area you travel to; set up payouts.', '2d. a travelling Service needs a photo, a travel area and payouts');
select throws_ok(format($$ insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id, status)
  values (%L, 'experience', %L, %L, 'SA straight in', 'Inserted live, with nothing behind it.', 6500, 60, %L, 'live') $$, :'p', :'exp', :'atl', :'area'),
  '23514', NULL, '2e. a listing can''t be inserted live either');
update providers set stripe_account_id = 'acct_test_sa', stripe_charges_enabled = true, stripe_payouts_enabled = true where id = :'p';
select tests.make_ready(:'lsp');
select lives_ok(format($$ update listings set status = 'live', published_at = now() where id = %L $$, :'lsp'), '2f. a ready Service goes live');
-- Already live: a later change elsewhere never blocks unrelated saves.
-- Stripe pauses the provider's payouts after it's live.
update providers set stripe_payouts_enabled = false where id = :'p';
select lives_ok(format($$ update listings set price_cents = 5000, description = 'A classic cut, with a wash, style and a hot towel.' where id = %L $$, :'lsp'),
  '2g. a live listing whose payouts lapsed still saves other changes');
select lives_ok(format($$ update listings set status = 'live' where id = %L $$, :'lsp'), '2h. ...and setting the same status isn''t a move');
update providers set stripe_payouts_enabled = true where id = :'p';

-- ---------------------------------------------------------------------------
-- 3. LISTING REVIEW: admin_set_listing_status
-- ---------------------------------------------------------------------------

-- Support, through the server on their own session.
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Too short') $$, :'sup', :'lsp'), '23514',
  'Give a reason of at least 10 characters. The provider sees it.', '3a. taking one down needs a reason of 10+ characters');
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'live') $$, :'sup', :'lsc'), '23514',
  'Services go live without review, so they can''t be approved.', '3b. a Service is never approved');
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'draft', 'live') $$, :'sup', :'le'), '23514',
  'A listing can''t go from draft to live in review.', '3c. only the four review moves');
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'unpublished', 'live') $$, :'sup', :'le'), '55000',
  'This listing changed in the meantime. Reload the page and try again.', '3d. a listing that''s moved on since the page loaded: refused');
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'live') $$, :'sup', :'le'), '3e. support approves a ready Experience');
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Photos show another business.') $$, :'sup', :'lsp'),
  '3f. support takes a live Service down');
select tests.clear_authentication();
select is((select status || '|' || (published_at is not null)::text || '|' || (reviewed_at is not null)::text from listings where id = :'le'),
  'live|true|true', '3g. approved: live, published and reviewed');
select is((select status || '|' || unpublished_reason from listings where id = :'lsp'), 'unpublished|Photos show another business.', '3h. taken down, with the reason the provider sees');
select is((select string_agg(action || ':' || coalesce(reason, '-') || ':' || admin_id::text, ',' order by created_at, action)
             from admin_actions where target = 'listing' and target_id in (:'le', :'lsp')),
  'approve_listing:-:' || :'sup' || ',unpublish_listing:Photos show another business.:' || :'sup', '3i. both logged, who and why');
select is((select count(*)::int from notifications where listing_id in (:'le', :'lsp') and kind in ('listing_approved', 'listing_unpublished')), 2,
  '3j. the provider is told of each');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where n.kind = 'listing_taken_down' and a.target_id = :'lsp' and n.recipient_id in (:'owner', :'owner2')), 2,
  '3k. support taking a listing down: every owner''s bell');
select is((select count(*)::int from admin_emails e join admin_actions a on a.id = e.admin_action_id
            where e.kind = 'admin_listing_taken_down' and a.target_id = :'lsp'), 2, '3l. ...and inbox');
select is((select count(*)::int from admin_notifications where kind = 'listing_taken_down' and recipient_id = :'sup'), 0, '3m. ...not support''s own');

-- Restore: blocked while something blocks going live, then allowed.
update providers set stripe_payouts_enabled = false where id = :'p';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'unpublished', 'live') $$, :'sup', :'lsp'), '23514',
  'Before it can go live: set up payouts.', '3n. restoring is refused while payouts aren''t ready');
select tests.clear_authentication();
update providers set stripe_payouts_enabled = true where id = :'p';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'unpublished', 'live') $$, :'sup', :'lsp'), '3o. support restores it once ready');
select tests.clear_authentication();
select is((select status || '|' || coalesce(unpublished_reason, '-') from listings where id = :'lsp'), 'live|-', '3p. live again, the reason cleared');

-- The owner taking one down: logged, no alert (they are the owners).
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Owner checking the takedown path.') $$, :'owner', :'lsp'),
  '3q. the owner takes one down');
select tests.clear_authentication();
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where n.kind = 'listing_taken_down' and a.admin_id = :'owner'), 0, '3r. ...and no owner is alerted about the owner');

-- Send back, with a reason.
insert into listings (provider_id, kind, category_id, city_id, title, description, price_cents, duration_minutes, area_id)
values (:'p', 'experience', :'exp', :'atl', 'SA second crawl', 'Another walk, with different stops.', 6500, 60, :'area') returning id as le2 \gset
select tests.make_ready(:'le2');
update listings set status = 'submitted' where id = :'le2';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'sup_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_set_listing_status(%L, %L, 'submitted', 'rejected', 'Add the meeting point details.') $$, :'sup', :'le2'),
  '3s. support sends an Experience back');
select tests.clear_authentication();
select is((select status || '|' || rejection_reason from listings where id = :'le2'), 'rejected|Add the meeting point details.', '3t. ...with the reason');

-- Who may call it.
select set_config('request.headers', json_build_object('x-lokl-admin-session', gen_random_uuid())::text, true);
select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'Not on the team at all.') $$, :'cust', :'le'), '42501',
  'Only lokl''s team can review listings.', '3u. not someone off the team, through the server');
select tests.authenticate_as(:'sup', 'admin', 'aal2', :'sup_session');
select throws_ok(format($$ select admin_set_listing_status(%L, %L, 'live', 'unpublished', 'From the browser directly.') $$, :'sup', :'le'), '42501',
  'permission denied for function admin_set_listing_status', '3v. never from a browser');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------
-- 4. SETTINGS: the owner's, logged, every owner told
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok($$ select admin_update_settings(20000, 5, 50000, 40, 20, 'Support raising it.') $$, '42501',
  'Only the owner can change the settings.', '4a. support can''t change the settings');
select throws_ok($$ update admin_settings set refund_limit_cents = 99900 $$, '42501', NULL, '4b. ...or write the table');
select tests.authenticate_as(:'cust', null, 'aal2', null);
select throws_ok($$ select admin_update_settings(20000, 5, 50000, 40, 20, 'A customer trying.') $$, '42501',
  'Only the owner can change the settings.', '4c. nor a customer');
select tests.authenticate_as_anon();
select throws_ok($$ select admin_update_settings(20000, 5, 50000, 40, 20, 'A visitor trying.') $$, '42501', NULL, '4d. nor a visitor');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select throws_ok($$ select admin_update_settings(20000, 5, 50000, 30, 20, 'no') $$, '23514',
  'Say why you''re changing the settings, in a few words.', '4e. a reason is needed');
select throws_ok($$ select admin_update_settings(15000, 5, 50000, 40, 20, 'Nothing different here.') $$, '23514', 'Nothing changed.', '4f. a change is needed');
select throws_ok($$ select admin_update_settings(-1, 5, 50000, 40, 20, 'A negative limit.') $$, '23514', NULL, '4g. the table''s ranges hold');
select lives_ok($$ select admin_update_settings(20000, 5, 50000, 30, 20, 'More refunds without asking; fewer lookups.') $$, '4h. the owner changes two');
select tests.clear_authentication();
select is((select refund_limit_cents || '/' || support_contact_views_per_day from admin_settings), '20000/30', '4i. ...saved');
select is((select message || '|' || reason || '|' || admin_id::text || '|' || coalesce(target_id::text, 'none') from admin_actions where action = 'change_admin_settings'),
  'Refund limit $150.00 to $200.00; contact views a day 40 to 30.|More refunds without asking; fewer lookups.|' || :'owner' || '|none',
  '4j. logged: what changed in words, why, who');
select is((select count(*)::int from admin_notifications n join admin_actions a on a.id = n.admin_action_id
            where n.kind = 'settings_change' and a.action = 'change_admin_settings' and n.recipient_id in (:'owner', :'owner2')), 2,
  '4k. every owner''s bell');
select is((select count(*)::int from admin_emails where kind = 'admin_settings_change'), 2, '4l. ...and inbox');

-- ---------------------------------------------------------------------------
-- 5. LOGS: guides, the homepage, categories, markets and areas
-- ---------------------------------------------------------------------------

insert into guides (market_id, slug, draft_title, draft_teaser, draft_body, draft_area_id)
values (:'atl', 'sa-guide', 'SA guide to the BeltLine', 'Murals, food halls and the Eastside Trail, a short walk from downtown.',
        '{"blocks": [{"type": "paragraph", "data": {"text": "A walk east."}}]}', :'area') returning id as g \gset
insert into guide_photos (guide_id, storage_path, width, height, alt_text, source)
values (:'g', :'g' || '/' || gen_random_uuid() || '.jpg', 1600, 900, 'Murals along the trail', 'own') returning id as cover \gset
update guides set draft_cover_photo_id = :'cover' where id = :'g';
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select publish_guide(%L, %L) $$, :'g', :'owner'), '5a. the owner publishes a guide');
select tests.clear_authentication();
select is((select action || '|' || message from admin_actions where target = 'guide' and target_id = :'g'), 'publish_guide|SA guide to the BeltLine',
  '5b. ...logged with its title');
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select lives_ok(format($$ select admin_set_homepage_features(array[%L]::uuid[]) $$, :'g'), '5c. the owner puts it on the homepage');
select tests.clear_authentication();
select is((select message || '|' || admin_id::text || '|' || coalesce(target_id::text, 'none') from admin_actions where action = 'set_homepage_features'),
  '1. SA guide to the BeltLine|' || :'owner' || '|none', '5d. ...logged: which guides, in order');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select throws_ok(format($$ select admin_set_homepage_features(array[%L]::uuid[]) $$, :'g'), '42501',
  'Only the owner can choose the homepage''s guides.', '5e. support can''t choose the homepage');
select set_config('request.headers', json_build_object('x-lokl-admin-session', :'owner_session')::text, true);
select tests.authenticate_as_service_role();
select lives_ok(format($$ select unpublish_guide(%L, %L) $$, :'g', :'owner'), '5f. the owner unpublishes it');
select lives_ok(format($$ select unpublish_guide(%L, %L) $$, :'g', :'owner'), '5g. ...twice');
select tests.clear_authentication();
select is((select count(*)::int from admin_actions where target_id = :'g' and action = 'unpublish_guide'), 1, '5h. ...logged once: only an actual change is');

-- The owner's direct writes to the reference lists.
select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
insert into categories (kind, name, slug) values ('service', 'SA tailoring', 'sa-tailoring') returning id as cat \gset
update categories set name = 'SA alterations', slug = 'sa-alterations' where id = :'cat';
update categories set active = false where id = :'cat';
update categories set sort_order = sort_order where id = :'cat';
insert into service_areas (city_id, kind, name) values (:'atl', 'neighborhood', 'SA Heights') returning id as area2 \gset
update cities set name = name || '' where id = :'atl';
select tests.clear_authentication();
select is((select string_agg(action || ':' || message, ' / ' order by created_at, id) from admin_actions where target = 'category' and target_id = :'cat'),
  'add_category:SA tailoring / change_category:SA alterations: changed name, slug / change_category:SA alterations: turned off',
  '5i. a category added, renamed and turned off: each logged with what changed; a save that changes nothing isn''t');
select is((select action || ':' || admin_id::text from admin_actions where target = 'area' and target_id = :'area2'), 'add_area:' || :'owner',
  '5j. an area added: logged, with who');
select is((select count(*)::int from admin_actions where target = 'market' and target_id = :'atl'), 0, '5k. a market saved unchanged: nothing logged');
select is((select count(*)::int from admin_actions where target = 'area' and target_id = :'area'), 0,
  '5l. rows written outside the API (fixtures, migrations) aren''t logged');
select throws_ok($$ update admin_actions set message = 'edited' where action = 'add_area' $$, '23514', NULL, '5m. the log stays append-only');

-- ---------------------------------------------------------------------------
-- 6. THE ACTIVITY PAGE
-- ---------------------------------------------------------------------------

select tests.authenticate_as(:'owner', null, 'aal2', :'owner_session');
select is((admin_activity_page() ->> 'total')::int, (select count(*)::int from admin_actions), '6a. the owner sees everyone''s actions');
select is((admin_activity_page(:'sup') ->> 'total')::int, (select count(*)::int from admin_actions where admin_id = :'sup'), '6b. ...or one person''s');
select is(admin_activity_page(:'sup') -> 'rows' -> 0 ->> 'admin_email', 'sa-support@test.local', '6c. ...naming who');
select tests.authenticate_as(:'sup', null, 'aal2', :'sup_session');
select is((admin_activity_page() ->> 'total')::int, (select count(*)::int from admin_actions where admin_id = :'sup'), '6d. support sees their own');
select is((admin_activity_page(:'owner') ->> 'total')::int, (select count(*)::int from admin_actions where admin_id = :'sup'),
  '6e. ...even when asking for someone else''s');
select is((select count(*)::int from jsonb_array_elements(admin_activity_page(p_page_size := 2) -> 'rows')), 2, '6f. a page at a time');
select tests.authenticate_as(:'cust', null, 'aal2', null);
select throws_ok($$ select admin_activity_page() $$, '42501', 'Only lokl''s team can see the activity.', '6g. not a customer');
select tests.authenticate_as_anon();
select throws_ok($$ select admin_activity_page() $$, '42501', NULL, '6h. nor a visitor');
select tests.clear_authentication();

select * from finish();
rollback;
