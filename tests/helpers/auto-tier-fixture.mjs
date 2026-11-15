import {seed,sql,ids,quote} from './local-db.mjs';
export function seedAutoTiers(){seed();sql(`truncate activities,attend_records,tier_history,alert_log restart identity;
 update teachers set tier='정교사'; update teachers set tier='휴교사' where member_id='${ids.member}';`);}
export function addRecords(id,count,at='2026-11-13',name='가짜 활동',raw=id){
 sql(`insert into activities(member_id,name,submitted_at,activities,roles)select ${quote(raw)},${quote(name)},${quote(at)}::timestamp,array['복음방','상담'],array['교사'] from generate_series(1,${count})`);
}
export function autoInputs(){return Object.fromEntries(['teachers','activities','attend_records'].map(table=>[table,JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by ${table==='teachers'?'sort_order,member_id':'id'}),'[]') from ${table} t`))]));}
export const tierSnapshot=()=>sql("select jsonb_build_object('teachers',(select jsonb_agg(to_jsonb(t) order by member_id) from teachers t),'history',(select jsonb_agg(to_jsonb(t) order by id) from tier_history t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from roster_changes t),'dayLog',(select jsonb_agg(to_jsonb(t) order by id) from alert_log t))");
