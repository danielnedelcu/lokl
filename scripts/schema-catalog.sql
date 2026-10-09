-- The schema as the API and the apps see it, one line per fact, for
-- scripts/schema-compare.mjs: tables (with row security), columns,
-- constraints, indexes, policies (also on storage.objects), triggers with
-- their enabled state, functions by full definition (an md5) with security
-- definer and settings, views with their options, every table, column,
-- function and schema grant, default privileges, extensions, storage buckets
-- and cron jobs. Whitespace inside a value is collapsed so each fact is one
-- line. Read-only.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
-- Our schemas: public and private (and storage, for the policies and buckets the migrations add).
select 'table', n.nspname||'.'||c.relname, 'rls='||c.relrowsecurity||' force='||c.relforcerowsecurity||' kind='||c.relkind::text
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S');
select 'column', table_schema||'.'||table_name||'.'||column_name, data_type||' null='||is_nullable||' default='||coalesce(column_default,'')||' generated='||regexp_replace(coalesce(generation_expression,''),'\s+',' ','g')
from information_schema.columns where table_schema in ('public','private');
select 'constraint', n.nspname||'.'||cl.relname||'.'||c.conname, regexp_replace(pg_get_constraintdef(c.oid),'\s+',' ','g')
from pg_constraint c join pg_class cl on cl.oid=c.conrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname in ('public','private');
select 'index', schemaname||'.'||indexname, indexdef from pg_indexes where schemaname in ('public','private');
select 'policy', schemaname||'.'||tablename||'.'||policyname, cmd||' roles='||array_to_string(roles,',')||' permissive='||permissive||' using='||regexp_replace(coalesce(qual,''),'\s+',' ','g')||' check='||regexp_replace(coalesce(with_check,''),'\s+',' ','g')
from pg_policies where schemaname in ('public','private','storage');
select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, 'enabled='||t.tgenabled::text||' '||pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private','storage','auth')
  and (n.nspname in ('public','private') or t.tgfoid in (select p.oid from pg_proc p join pg_namespace pn on pn.oid=p.pronamespace where pn.nspname in ('public','private')));
select 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid))||' secdef='||p.prosecdef||' config='||coalesce(array_to_string(p.proconfig,','),'')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind in ('f','p');
select 'view', n.nspname||'.'||c.relname, md5(pg_get_viewdef(c.oid))||' options='||coalesce(array_to_string(c.reloptions,','),'')
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('v','m');
select 'rel_grant', n.nspname||'.'||c.relname, (case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' '||a.privilege_type
from pg_class c join pg_namespace n on n.oid=c.relnamespace, aclexplode(coalesce(c.relacl, acldefault((case when c.relkind='S' then 's' else 'r' end)::"char", c.relowner))) a
where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S');
select 'col_grant', n.nspname||'.'||c.relname||'.'||at.attname, (case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' '||a.privilege_type
from pg_attribute at join pg_class c on c.oid=at.attrelid join pg_namespace n on n.oid=c.relnamespace, aclexplode(at.attacl) a
where n.nspname in ('public','private') and at.attacl is not null;
select 'fn_grant', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', (case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' '||a.privilege_type
from pg_proc p join pg_namespace n on n.oid=p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a where n.nspname in ('public','private');
select 'schema_grant', n.nspname, (case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' '||a.privilege_type
from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a where n.nspname in ('public','private');
select 'default_acl', coalesce(n.nspname,'*')||' by '||d.defaclrole::regrole::text||' on '||d.defaclobjtype::text, (case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end)||' '||a.privilege_type
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace, aclexplode(d.defaclacl) a where coalesce(n.nspname,'*') in ('public','private','*','storage');
select 'extension', extname, extversion from pg_extension;
select 'bucket', id, 'public='||public||' size='||coalesce(file_size_limit::text,'')||' types='||coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets;
select 'select ''cron'', jobname, schedule||'' ''||md5(command)||'' active=''||active from cron.job' where to_regclass('cron.job') is not null \gexec
select 'cron_installed', (to_regclass('cron.job') is not null)::text, '';
