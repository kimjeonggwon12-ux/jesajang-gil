-- 운영/로컬 공통 구조 대조. 업무 행·함수 본문·예약 명령·인증 값은 반환하지 않는다.
begin read only;
set local statement_timeout = '3s';
set local lock_timeout = '500ms';
with relations as (
  select c.*, n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S')
), objects as (
  select 'environment' kind, jsonb_build_object('read_only',current_setting('transaction_read_only'),
    'server_version',current_setting('server_version'), 'database',current_database(),
    'migration_table',to_regclass('supabase_migrations.schema_migrations')::text,
    'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname) from pg_extension)) payload
  union all
  select 'relation',jsonb_build_object('name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'options',c.reloptions,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
    'view_hash',case when c.relkind in ('v','m') then md5(pg_get_viewdef(c.oid,true)) end,
    'estimated_rows',case when c.relkind in ('r','p') then c.reltuples end)
  from relations c
  union all
  select 'column',jsonb_build_object('table',c.relname,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'default_hash',case when d.oid is not null then md5(pg_get_expr(d.adbin,d.adrelid)) end,
    'collation',case when a.attcollation<>0 then a.attcollation::regcollation::text end)
  from relations c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.relkind<>'S'
  union all
  select 'constraint',jsonb_build_object('table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,true),
    'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred)
  from pg_constraint k join relations c on c.oid=k.conrelid
  union all
  select 'index',jsonb_build_object('table',c.relname,'name',i.indexrelid::regclass::text,'definition',pg_get_indexdef(i.indexrelid),
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique)
  from pg_index i join relations c on c.oid=i.indrelid
  union all
  select 'function',jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),
    'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'language',l.lanname,
    'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'owner',pg_get_userbyid(p.proowner),
    'settings',(select jsonb_agg(v order by v) from unnest(p.proconfig) v where v like 'search_path=%' or v like 'statement_timeout=%' or v like 'lock_timeout=%'),
    'definition_hash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prokind in ('f','p')
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  union all
  select 'policy',jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,
    'using_hash',md5(qual),'check_hash',md5(with_check)) from pg_policies where schemaname='public'
  union all
  select 'trigger',jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
    'definition_hash',md5(pg_get_triggerdef(t.oid,true)), 'function',t.tgfoid::regprocedure::text)
  from pg_trigger t join relations c on c.oid=t.tgrelid where not t.tgisinternal
  union all
  select 'default_acl',jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',coalesce(n.nspname,''),'type',d.defaclobjtype,'acl',d.defaclacl::text)
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' or d.defaclnamespace=0
)
select jsonb_agg(jsonb_build_object('kind',kind,'payload',payload) order by kind,payload::text)::text as schema_objects from objects;
rollback;
