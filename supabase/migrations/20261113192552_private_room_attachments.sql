-- 공개 원본은 보존. 새 방 첨부의 소속·일회 소비와 메시지 저장을 함께 확정한다.
create table public.room_attachments (
 id uuid primary key, target_id text not null, uploader_nid text not null,
 kind text not null check(kind in ('file','photo')), name text not null, mime text not null,
 byte_size bigint not null check(byte_size>0 and byte_size<=52428800),
 object_key text not null, staging_key text not null default '', variants jsonb not null default '{}',
 message_id bigint, created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index room_attachments_target_idx on public.room_attachments(target_id,message_id);
alter table public.room_attachments enable row level security;
revoke all on public.room_attachments from public,anon,authenticated;
grant all on public.room_attachments to service_role;

-- 접근 판단 전에 읽고 저장 직전에 재대조한다. 읽음 커서의 변화는 권한 변화가 아니다.
create function public.room_access_revision(p_tid text,p_nid text) returns text
language sql stable security invoker set search_path='' as $fn$
 select md5(jsonb_build_object(
  'target',(select to_jsonb(t) from public.targets t where target_id=p_tid),
  'teachers',(select jsonb_agg(to_jsonb(t) order by t.sort_order,t.member_id) from public.teachers t
    where t.nid=p_nid or t.nid=(select creator_nid from public.targets where target_id=p_tid)),
  'admins',(select jsonb_agg(to_jsonb(a) order by a.id) from public.admins a where a.nid=p_nid),
  'member',(select jsonb_build_array(m.id,m.role,m.invited_by) from public.target_room_members m where m.target_id=p_tid and m.nid=p_nid)
 )::text);
$fn$;

create function public.room_message_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $fn$
declare tid text:=p->>'targetId'; nid text:=p->>'actorNid'; row public.target_room_messages; att public.room_attachments;
 r jsonb; a_id uuid; mem public.target_room_members; photo text:=''; file_ref text:=''; file_name text:=''; file_size bigint:=0;
begin
 -- 기존 권한 변경과 같은 순서. 짧은 저장 트랜잭션 안에서만 대상과 소속을 고정한다.
 lock table public.teachers,public.admins in share mode;
 if p->>'actorGuest'='true' then
  if p->>'actorRoom' is distinct from tid or (p->>'actorExpires')::bigint<=extract(epoch from now()) then return jsonb_build_object('error','로그인이 만료됐어요.'); end if;
 else
  if not public.sensitive_actor_valid(p) then return jsonb_build_object('error','로그인이나 담당 범위가 바뀌었어요. 다시 확인해 주세요.'); end if;
 end if;
 perform 1 from public.targets where target_id=tid for update;
 if not found then return jsonb_build_object('error','없는 방이에요.'); end if;
 lock table public.target_room_members in share row exclusive mode;
 if public.room_access_revision(tid,nid) is distinct from p->>'expected' then
  return jsonb_build_object('error','담당 범위가 바뀌었어요. 방을 다시 열어 주세요.','stale',true);
 end if;
 if p->>'operation'='send' then
  for r in select * from jsonb_array_elements(coalesce(p->'attachments','[]'::jsonb)) loop
   a_id:=(r->>'id')::uuid;
   select * into att from public.room_attachments where id=a_id for update;
   if not found or att.target_id<>tid or att.uploader_nid<>nid or att.message_id is not null or att.expires_at<=now() or att.kind<>r->>'kind' then
    return jsonb_build_object('error','첨부가 만료되었거나 이미 전송됐어요. 대화를 확인해 주세요.');
   end if;
   if r->>'object_key' not like 'room-private/'||att.id::text||'/%' then raise exception 'invalid attachment key'; end if;
   if att.kind='photo' then photo:='room-private:'||att.id;
   else file_ref:='room-private:'||att.id;file_name:=att.name;file_size:=att.byte_size; end if;
  end loop;
  select * into mem from public.target_room_members where target_id=tid and target_room_members.nid=p->>'actorNid';
  if not found then
   insert into public.target_room_members(target_id,member_id,name,role,joined_at) values(tid,p->>'actorId',p->>'actorName',p->>'memberRole',timezone('Asia/Seoul',now())) returning * into mem;
  end if;
  insert into public.target_room_messages(target_id,from_id,from_name,body,photo,file_url,file_name,file_size,pinned,pinned_by,created_at)
   values(tid,p->>'actorId',p->>'actorName',left(coalesce(p->>'text',''),3000),photo,file_ref,file_name,file_size,
    coalesce((p->>'pin')::boolean,false),case when p->>'pin'='true' then p->>'actorName' else '' end,timezone('Asia/Seoul',now())) returning * into row;
  for r in select * from jsonb_array_elements(coalesce(p->'attachments','[]'::jsonb)) loop
   update public.room_attachments set message_id=row.id,object_key=r->>'object_key',staging_key='' where id=(r->>'id')::uuid;
  end loop;
  update public.target_room_members set last_read_id=greatest(last_read_id,row.id) where id=mem.id;
  return jsonb_build_object('ok',true,'row',to_jsonb(row),'memberKey',mem.id);
 elsif p->>'operation'='delete' then
  select * into row from public.target_room_messages where id=(p->>'id')::bigint and target_id=tid for update;
  if not found then return jsonb_build_object('error','없는 글이에요.');end if;
  if row.from_nid<>nid and not coalesce((p->>'isOwner')::boolean,false) then return jsonb_build_object('error','내가 쓴 글만 지울 수 있어요.');end if;
  update public.target_room_messages set deleted=true,pinned=false,body='',photo='',file_url='',file_name='',file_size=0 where id=row.id;
  -- 공개/비공개 보관본은 여기서 삭제하지 않는다. 열람 경로는 삭제 상태를 즉시 확인한다.
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'unknown room operation';
end $fn$;
revoke all on function public.room_access_revision(text,text),public.room_message_apply(jsonb) from public,anon,authenticated;
grant execute on function public.room_access_revision(text,text),public.room_message_apply(jsonb) to service_role;
