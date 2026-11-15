// 보관한 0ea5ac7 함수 본문을 그대로 실행한다. DB 읽기만 전달받은 자료로 대체하고 쓰기는 금지한다.
import vm from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../fixtures/legacy-auto-tiers-0ea5.js.txt',import.meta.url),'utf8');
export async function legacyAutoPlan(teachers,activities,attends,day){
 const ruleMonth=day=>{const [y,m]=day.split('-').map(Number);return {start:[`${y}-${String(m).padStart(2,'0')}-01`,'2026-11-05'].sort().at(-1),end:`${y}-${String(m).padStart(2,'0')}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`};};
 const known=new Set(teachers.map(t=>t.nid)),names=new Map();for(const t of teachers)names.set(t.name,names.has(t.name)?null:t.nid);
 const normalized=structuredClone(activities);for(const a of normalized)if(a.nid&&!known.has(a.nid)){const n=names.get(String(a.name||'').trim());if(n)a.nid=n;}
 const ctx={kstDate:()=>day,ruleMonth,prevMonthDay:day=>{const[y,m]=day.split('-').map(Number);return new Date(Date.UTC(y,m-2,15)).toISOString().slice(0,10);},AUTO_RULE_START:'2026-11-05',ACTIVE_MIN_RECORDS:4,OTHER_ATTEND_GOAL:2,ymd:s=>String(s||'').slice(0,10),
  otherPending:t=>!!t&&(t.tier==='기타'||(t.month_stats?.tierRaw==='기타'&&t.tier==='휴교사'&&(!t.tier_changed_at||String(t.tier_changed_at).slice(0,10)<='2026-11-05'))),
  db:()=>({from:table=>{const q={table,select:()=>q,order:()=>q,gte:()=>q};return q;}}),selectAll:async build=>build().table==='teachers'?structuredClone(teachers):attends.filter(a=>a.at&&a.at>='2026-11-05'),loadActivities:async()=>normalized,
  writeTierChanges:()=>{throw Error('Legacy reference must never write');}};
 vm.createContext(ctx);return JSON.parse(JSON.stringify(await vm.runInContext(code+'\nautoRestTiers({dryRun:true})',ctx)));
}
