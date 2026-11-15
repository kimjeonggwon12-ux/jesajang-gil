// 실제 DB에 연결하지 않는 권한 회귀 검증용 저장소. 지원하지 않는 쿼리는 실패시킨다.
import { readdirSync, readFileSync } from 'node:fs';
const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
const tables = new Set(readdirSync(migrationDir).flatMap(f => [...readFileSync(new URL(f, migrationDir), 'utf8')
  .matchAll(/create table(?: if not exists)?\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1])));
export const rows = {};
export const calls = [];
export const faults = new Set();
// 읽기와 쓰기 사이 다른 요청이 상태를 바꾸는 상황을 기능 단위로 재현한다.
export const beforeQuery = [];
const clone = v => structuredClone(v);
const nid = v => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '') || '0';
export function reset(seed = {}) {
  for (const key of Object.keys(rows)) delete rows[key];
  for (const table of tables) rows[table] = [];
  for (const [table, value] of Object.entries(seed)) rows[table] = clone(value);
  rows.center_approval_policy=[{id:1,mode:'legacy_global',version:1}];
  calls.length = 0; faults.clear(); beforeQuery.length = 0;
}
function generated(row) {
  const out = { ...row };
  for (const [field, target] of [['member_id', 'nid'], ['from_id', 'from_nid'], ['to_id', 'to_nid'], ['teacher_id', 'teacher_nid']]) {
    if (field in out) out[target] = nid(out[field]);
  }
  return out;
}
class Query {
  constructor(table) {
    if (!Object.hasOwn(rows, table)) throw new Error('Unsupported fake table: ' + table);
    this.table = table; this.filters = []; this.sort = []; this.operation = 'read'; this.columns = '*';
  }
  select(columns = '*', options = {}) { this.columns = columns; this.options = options; return this; }
  eq(k, v) { this.filters.push(r => r[k] === v); return this; }
  neq(k, v) { this.filters.push(r => r[k] !== v); return this; }
  in(k, values) { this.filters.push(r => values.includes(r[k])); return this; }
  gte(k, v) { this.filters.push(r => r[k] >= v); return this; }
  lte(k, v) { this.filters.push(r => r[k] <= v); return this; }
  gt(k, v) { this.filters.push(r => r[k] > v); return this; }
  lt(k, v) { this.filters.push(r => r[k] < v); return this; }
  is(k, v) { return this.eq(k, v); }
  match(values) { for (const [k,v] of Object.entries(values)) this.eq(k,v); return this; }
  like(k, value) { const re = new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$'); this.filters.push(r => re.test(r[k] || '')); return this; }
  or(value) {
    const predicates = value.split(',').map(part => {
      const [k, op, ...tail] = part.split('.');
      if (op !== 'eq') throw new Error('Unsupported fake OR');
      return r => String(r[k]) === tail.join('.');
    });
    this.filters.push(r => predicates.some(fn => fn(r))); return this;
  }
  order(k, { ascending = true } = {}) { this.sort.push([k, ascending]); return this; }
  limit(n) { this.max = n; return this; }
  range(a,b) { this.bounds = [a,b]; return this; }
  insert(value) { this.operation = 'insert'; this.value = Array.isArray(value) ? value : [value]; return this; }
  upsert(value, options = {}) { this.insert(value); this.operation = 'upsert'; this.conflict = options.onConflict || (this.table === 'member_pins' ? 'nid' : 'id'); return this; }
  update(value) { this.operation = 'update'; this.value = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    calls.push({ table: this.table, operation: this.operation });
    if (faults.has(this.table)) return { data: null, error: { message: 'simulated unavailable database' } };
    for (const hook of beforeQuery) await hook(this);
    let table = rows[this.table], matched = table.filter(r => this.filters.every(fn => fn(r)));
    if (this.operation === 'delete') rows[this.table] = table.filter(r => !matched.includes(r));
    if (this.operation === 'update') matched.forEach(r => Object.assign(r, generated({ ...r, ...clone(this.value) })));
    if (this.operation === 'insert' || this.operation === 'upsert') {
      matched = [];
      for (const input of this.value) {
        const next = generated(clone(input));
        const unique = this.table === 'attend_records' ? ['meeting_id', 'nid'] : this.table === 'target_room_members' ? ['target_id', 'nid'] : null;
        if (unique && table.some(r => unique.every(k => r[k] === next[k]))) return { data: null, error: { message: 'duplicate key' } };
        const existing = this.operation === 'upsert' && table.find(r => this.conflict.split(',').every(k => r[k] === next[k]));
        if (existing) { Object.assign(existing, next); matched.push(existing); }
        else { next.id ??= Math.max(0, ...table.map(r => r.id || 0)) + 1; table.push(next); matched.push(next); }
      }
    }
    const count = matched.length;
    matched = [...matched].sort((a,b) => {
      for (const [key,asc] of this.sort) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (asc ? 1 : -1);
      return 0;
    });
    if (this.bounds) matched = matched.slice(this.bounds[0], this.bounds[1]+1);
    if (this.max != null) matched = matched.slice(0,this.max);
    if (this.columns !== '*') matched = matched.map(r => Object.fromEntries(this.columns.split(',').map(k => [k.trim(), r[k.trim()]])));
    return { data: this.options?.head ? null : clone(matched), count, error: null };
  }
}
const centerState=id=>({
 teacher:(()=>{const r=rows.teachers.find(t=>t.nid===id);return r?Object.fromEntries(['member_id','name','dept','region','position'].map(k=>[k,r[k]||''])):null;})(),
 admins:rows.admins.filter(r=>r.nid===id).sort((a,b)=>a.id-b.id).map(r=>Object.fromEntries(['id','member_id','name','dept','region','position'].map(k=>[k,r[k]||'']))),
 centers:rows.centers.filter(c=>(c.staff||[]).some(s=>nid(s.memberId)===id)).map(c=>c.id).sort((a,b)=>a-b),
 policy:rows.center_approval_policy[0]?{mode:rows.center_approval_policy[0].mode,version:rows.center_approval_policy[0].version}:null,
});
export const db = () => ({
  from: table => new Query(table),
  rpc(name, args) {
    // 인증 경계의 성공 응답만 대체한다. 방 저장/첨부/경합은 실제 PostgreSQL 검사에서 검증한다.
    if(name==='room_access_revision')return Promise.resolve({data:'fake-room-revision',error:null});
    if(name==='room_membership_apply'){
      const p=args.p;
      let member=rows.target_room_members.find(m=>m.target_id===p.targetId&&m.nid===p.actorNid);
      if(!member&&['read','join'].includes(p.operation)){
        member={id:rows.target_room_members.length+1,target_id:p.targetId,member_id:p.actorId,nid:p.actorNid,name:p.actorName,role:p.operation==='join'?'초대':p.memberRole,last_read_id:0};
        rows.target_room_members.push(member);
      }
      if(member&&p.operation==='read')member.last_read_id=Math.max(member.last_read_id||0,p.lastId||0);
      return Promise.resolve({data:{ok:true,targetId:p.targetId,member:clone(member)},error:null});
    }
    if(name==='room_message_apply'){const p=args.p;return Promise.resolve({data:{ok:true,memberKey:1,row:{id:1,target_id:p.targetId,from_id:p.actorId,from_nid:p.actorNid,from_name:p.actorName,body:p.text,photo:'',file_url:'',created_at:'2026-11-01'}},error:null});}

    if(name==='center_scope_state')return Promise.resolve({data:clone(centerState(args.p_nid)),error:null});
    if(name==='center_referral_apply')return (async()=>{
      const p=args.p;
      for(const hook of beforeQuery)await hook({table:'center_referrals',operation:'update'});
      const row=rows.center_referrals.find(r=>r.id===p.expected.id),pin=rows.member_pins.find(r=>r.nid===p.actorNid);
      if(JSON.stringify(centerState(p.actorNid))!==JSON.stringify(p.scopeState)||pin?.ver!==p.actorVer||!row||Object.entries(p.expected).some(([k,v])=>row[k]!==v))return {data:{error:'담당 범위 또는 상태가 바뀌었어요.',stale:true},error:null};
      if(p.operation==='read')return {data:{ok:true,row:clone(row)},error:null};
      Object.assign(row,p.patch);return {data:{ok:true,id:row.id},error:null};
    })();
    // 권한 회귀는 전환 없는 결과만 대체한다. 자동 계산/쓰기/동시성은 실제 local-auto-tiers에서 검사한다.
    // 상세 직책 API의 작업자/대상 경계 전용 대체. 원자성·경합은 실제 local-roster-leader에서 검사한다.
    if(name==='roster_member_state')return Promise.resolve({data:rows.teachers.filter(t=>args.p_nids.includes(t.nid)).map(t=>({row:clone(t),revision:JSON.stringify(t)})),error:null});
    if(name==='roster_leader_apply'){
      const p=args.p,t=rows.teachers.find(t=>t.nid===p.nid),before=clone(t);Object.assign(t,p.fields);
      rows.roster_changes.push({actor_id:p.actorId,actor_name:p.actorName,kind:'직책 지정',target_id:t.member_id,before,after:clone(t)});
      return Promise.resolve({data:{ok:true,updated:true},error:null});
    }
    if(name==='auto_tier_apply')return Promise.resolve(faults.has(name)?{data:null,error:{message:'local automatic tier unavailable'}}:{data:{ok:true,changes:[],progress:null,month:{},prevMonth:null},error:null});
    // API 권한/확인 계약 전용 최소 응답. 트랜잭션·동시성·DB 권한은 local-next-sensitive에서 실제 PostgreSQL로 검증한다.
    if(name==='tier_change_state')return Promise.resolve({data:rows.teachers.filter(t=>args.p_nids.includes(t.nid)).map(t=>({member_id:t.member_id,nid:t.nid,name:t.name,tier:t.tier,revision:JSON.stringify(t)})),error:null});
    if(name==='tier_change_apply'){
      for(const w of args.p.writes){Object.assign(rows.teachers.find(t=>t.member_id===w.member_id),{tier:w.new_tier});rows.tier_history.push({...w,approver1:'전도부 '+args.p.actorName});}
      return Promise.resolve({data:{ok:true},error:null});
    }
    if(name==='teacher_export_guard'){
      calls.push({table:'alert_log',operation:args.p.stage});
      const p=args.p,pin=rows.member_pins.find(r=>r.nid===p.actorNid);
      const t=rows.teachers.find(t=>t.nid===p.actorNid),admins=rows.admins.filter(a=>a.nid===p.actorNid).sort((a,b)=>a.id-b.id);
      const state={teacher:t?[t.member_id,t.name,t.dept,t.position]:null,admins:admins.map(a=>[a.id,a.member_id,a.name,a.dept,a.position])};
      if(JSON.stringify(state)!==JSON.stringify(p.actorState)||pin?.ver!==p.actorVer||!pin?.pin_hash)return Promise.resolve({data:{error:'담당자 권한이나 로그인이 바뀌었어요.',stale:true},error:null});
      if(p.stage==='ready'&&faults.has('alert_log'))return Promise.resolve({data:null,error:{message:'local audit failure'}});
      if(!p.passwordOk)return Promise.resolve({data:{error:'비밀번호가 맞지 않아요.'},error:null});
      if(p.stage==='ready')rows.alert_log.push({ok:true,summary:p.summary});
      return Promise.resolve({data:{ok:true},error:null});
    }
    // 인증/엑셀 경계 검사에서만 빈 집계 허용. 실제 계산은 local-aggregates의 원본 대조로 검증한다.
    if (name === 'teacher_report_facts' && ['activities','center_leads','teacher_profiles','app_visits','connect_cards','plaza_posts','attend_records'].every(t => !rows[t]?.length))
      return Promise.resolve({ data: [], error: null });
    // 원본 이력이 없는 인증 경계 검사 전용. 집계 정확도는 실제 격리 DB에서 대조한다.
    if (name === 'scope_tier_facts' && !rows.activities.length && !rows.center_leads.length && !rows.targets.length) {
      const scope=args.p_scope;
      return Promise.resolve({data:{ rows: rows.teachers.filter(t=>(!scope.dept || t.dept===scope.dept)&&(!scope.region || t.region===scope.region)).map(t=>({...clone(t),monthlyCount:0,lastActivityAt:null,lastActivityBefore:null,recentActivity:0,recentLeads:0,conditionLeads:0,reviewLeads:0,hasRecords:false,roleCounts:{}})), targetStageCounts:{},analysisRows:null},error:null});
    }
    if (name === 'member_info') return Promise.resolve({ data: { teacher: clone(rows.teachers.find(r => r.nid === args.p_nid) || null), admin: clone(rows.admins.find(r => r.nid === args.p_nid) || null) }, error: null });
    if (name === 'roster_counts') return Promise.resolve({ data: [], error: null });
    throw new Error('Unsupported fake RPC: ' + name);
  },
});
export async function run(query) { const {data,error} = await query; if (error) throw new Error(error.message); return data; }
export async function selectAll(build) { return run(build()); }
export const isDuplicate = error => /duplicate key/.test(error.message);
