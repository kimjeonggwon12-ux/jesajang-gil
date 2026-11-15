-- 방 삭제 전의 요청·첨부가 새 빈 방에 뒤늦게 확정되지 않도록 세대를 올린다.
alter table public.targets add column room_generation bigint not null default 0;

-- 서버가 현재 범위를 확인한 증거를 넘긴다. 서비스 역할 외에는 실행할 수 없다.
-- 메시지 확정과 동일한 잠금 순서: 명단/보직 → PIN → 대상자 → 방 참여자.
create or replace function public.room_membership_apply(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $fn$
<<room_write>>
declare
 tid text:=p->>'targetId'; nid text:=p->>'actorNid'; op text:=p->>'operation';
 actor_name text:=p->>'actorName'; guest boolean:=coalesce((p->>'actorGuest')::boolean,false);
 owner boolean; manager boolean; explicit boolean; self boolean; at_time timestamp:=timezone('Asia/Seoul',now());
 t public.targets; mem public.target_room_members; recipient public.target_room_members;
 inv public.target_room_invites; msg public.target_room_messages; candidate jsonb:=p->'invitee';
 recipient_nid text; entry_text text; file_count bigint;
begin
 lock table public.teachers,public.admins in share mode;
 if guest then
  if p->>'actorRoom' is distinct from tid or coalesce((p->>'actorExpires')::bigint,0)<=extract(epoch from now()) then
   return jsonb_build_object('error','로그인이 만료됐어요.');
  end if;
 elsif not public.sensitive_actor_valid(p) then
  return jsonb_build_object('error','로그인이나 담당 범위가 바뀌었어요. 다시 확인해 주세요.');
 end if;
 select * into t from public.targets where target_id=tid for update;
 if not found then return jsonb_build_object('error','없는 방이에요.');end if;
 lock table public.target_room_members in share row exclusive mode;
 select * into mem from public.target_room_members m where m.target_id=tid and m.nid=room_write.nid;
 owner:=not guest and (nid=t.creator_nid or nid=t.leader_nid or nid=t.helper_nid);
 owner:=coalesce(owner,false);
 explicit:=mem.id is not null and (mem.role='초대' or mem.role='관리자' and btrim(mem.invited_by)<>'');
 -- 링크 참여는 초대 자체를 현재 DB에서 확인하므로 기존 방 접근은 요구하지 않는다.
 if op='join' then
  select * into inv from public.target_room_invites where code=p->>'code' and target_id=tid for update;
  if not found or inv.revoked then return jsonb_build_object('error','없거나 끊긴 초대 링크예요. 담당 교사에게 새 링크를 받아 주세요.');end if;
  if explicit or owner then return jsonb_build_object('ok',true,'targetId',tid,'already',true);end if;
  if inv.expires_at is null or inv.expires_at<=at_time then return jsonb_build_object('error','초대 링크가 끝났어요(24시간). 담당 교사에게 새 링크를 받아 주세요.');end if;
  if inv.uses>=inv.max_uses then return jsonb_build_object('error','이 링크로는 '||inv.max_uses||'명이 이미 들어왔어요. 담당 교사에게 새 링크를 받아 주세요.');end if;
  if mem.id is null then
   insert into public.target_room_members(target_id,member_id,name,role,invited_by,joined_at)
    values(tid,p->>'actorId',actor_name,'초대',inv.created_name||' 링크',at_time);
  else
   update public.target_room_members set name=actor_name,role='초대',invited_by=inv.created_name||' 링크',joined_at=at_time where id=mem.id;
  end if;
  update public.target_room_invites set uses=uses+1 where id=inv.id;
  insert into public.target_room_messages(target_id,body,created_at) values(tid,actor_name||' 님이 초대 링크로 들어왔어요'||case when guest then ' (교사명단에 없는 분)' else '' end||'.',at_time);
  return jsonb_build_object('ok',true,'targetId',tid);
 end if;
 if public.room_access_revision(tid,nid) is distinct from p->>'expected' then
  return jsonb_build_object('error','담당 범위나 방이 바뀌었어요. 방을 다시 열어 주세요.','stale',true);
 end if;
 manager:=not guest and coalesce((p->>'canManage')::boolean,false);
 if not (owner or manager or explicit) then return jsonb_build_object('error','이 피드백방의 담당 범위가 아니거나 초대받지 않았어요.');end if;
 if op in ('createInvite','revokeInvite','invite') and not (owner or manager) then return jsonb_build_object('error','초대는 담당 교사·관리자만 할 수 있어요.');end if;
 if op='read' then
  if mem.id is null then
   insert into public.target_room_members(target_id,member_id,name,role,joined_at)
    values(tid,p->>'actorId',actor_name,case when owner then '담당' else '관리자' end,at_time) returning * into mem;
   if not owner then insert into public.target_room_messages(target_id,body,created_at) values(tid,actor_name||' 님(관리자)이 개강 피드백으로 들어왔어요.',at_time);end if;
  end if;
  if coalesce((p->>'lastId')::bigint,0)>mem.last_read_id then
   update public.target_room_members set last_read_id=greatest(last_read_id,(p->>'lastId')::bigint) where id=mem.id returning * into mem;
  end if;
  return jsonb_build_object('ok',true,'member',to_jsonb(mem));
 elsif op='createInvite' then
  insert into public.target_room_invites(code,target_id,created_by,created_name,created_at,expires_at,max_uses)
   values(p->>'code',tid,p->>'actorId',actor_name,at_time,at_time+interval '24 hours',5) returning * into inv;
  return jsonb_build_object('ok',true,'expires',inv.expires_at);
 elsif op='revokeInvite' then
  update public.target_room_invites set revoked=true where code=p->>'code' and target_id=tid;
  if not found then return jsonb_build_object('error','이 방의 초대 링크가 아니에요.');end if;
  return jsonb_build_object('ok',true);
 elsif op='invite' then
  -- 이름 검색 뒤 명단이 삭제/변경되었으면 과거 검색 결과로 초대하지 않는다.
  if not exists(select 1 from (
    select x.member_id,x.nid,x.name,x.dept,x.region,x.affiliation,x.position from public.teachers x
    union all select x.member_id,x.nid,x.name,x.dept,x.region,x.affiliation,x.position from public.admins x
   ) c where to_jsonb(c)=candidate) then return jsonb_build_object('error','명단이 바뀌었어요. 다시 찾아 주세요.');end if;
  recipient_nid:=candidate->>'nid';
  select * into recipient from public.target_room_members m where m.target_id=tid and m.nid=recipient_nid;
  if recipient_nid in (t.creator_nid,t.leader_nid,t.helper_nid) or recipient.id is not null and (recipient.role='초대' or recipient.role='관리자' and btrim(recipient.invited_by)<>'') then
   return jsonb_build_object('error',(candidate->>'name')||' 님은 이미 초대받은 분이에요.');
  end if;
  if recipient.id is null then
   insert into public.target_room_members(target_id,member_id,name,role,invited_by,joined_at)
    values(tid,candidate->>'member_id',candidate->>'name','초대',actor_name,at_time);
  else
   update public.target_room_members set member_id=candidate->>'member_id',name=candidate->>'name',role='초대',invited_by=actor_name,joined_at=at_time where id=recipient.id;
  end if;
  entry_text:=actor_name||' 님이 '||(candidate->>'name')||' 님을 초대했어요.';
 elsif op='leave' then
  select * into recipient from public.target_room_members where target_id=tid and id=coalesce((p->>'key')::bigint,mem.id);
  if not found then return jsonb_build_object('error','이 방에 없는 분이에요.');end if;
  self:=recipient.nid=nid;
  if not self and not (owner or manager) then return jsonb_build_object('error','내보내기는 담당 교사·관리자만 할 수 있어요.');end if;
  -- 예전 행의 역할 글자가 바뀌어 있어도 현재 담당 관계를 보호한다.
  if recipient.nid in (t.creator_nid,t.leader_nid,t.helper_nid) then return jsonb_build_object('error','담당 교사는 방에서 뺄 수 없어요.');end if;
  delete from public.target_room_members where id=recipient.id;
  entry_text:=case when self then recipient.name||' 님이 나갔어요.' else actor_name||' 님이 '||recipient.name||' 님을 내보냈어요.' end;
 elsif op='pin' then
  select * into msg from public.target_room_messages where target_id=tid and id=(p->>'id')::bigint for update;
  if not found or msg.deleted then return jsonb_build_object('error','없는 글이거나 지워진 글이에요.');end if;
  update public.target_room_messages set pinned=coalesce((p->>'pinned')::boolean,false),pinned_by=case when p->>'pinned'='true' then actor_name else '' end where id=msg.id;
  return jsonb_build_object('ok',true);
 elsif op='deleteRoom' then
  if not owner then return jsonb_build_object('error','피드백방은 담당 교사만 없앨 수 있어요.');end if;
  select count(*) filter(where photo<>'')+count(*) filter(where file_url<>'') into file_count from public.target_room_messages where target_id=tid;
  delete from public.target_room_messages where target_id=tid;
  delete from public.target_room_invites where target_id=tid;
  delete from public.target_room_members where target_id=tid;
  update public.room_attachments set expires_at=least(expires_at,now()) where target_id=tid and message_id is null;
  update public.targets set room_generation=room_generation+1 where target_id=tid;
  -- 외부 원본은 먼저 지우지 않는다. 별도 정리 정책/백업 범위로 보존한다.
  return jsonb_build_object('ok',true,'files',file_count);
 else
  raise exception 'unknown room membership operation';
 end if;
 insert into public.target_room_messages(target_id,body,created_at) values(tid,entry_text,at_time);
 return jsonb_build_object('ok',true,'name',candidate->>'name');
end $fn$;
revoke all on function public.room_membership_apply(jsonb) from public,anon,authenticated;
grant execute on function public.room_membership_apply(jsonb) to service_role;
