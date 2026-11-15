import {seedRemaining} from './remaining-fixture.mjs';
import {sql} from './local-db.mjs';
export const importColumns=['member_id','name','dept','region','affiliation','position','tier','note','tier_changed_at','reg_leads','unreg_leads','counsel','gospel_room','companion','active_state','month_stats','sort_order'];
export function teacherState(){return JSON.parse(sql('select json_agg(t order by sort_order,member_id) from teachers t'));}
export function comparable(rows){return rows.map(row=>Object.fromEntries(importColumns.map(key=>[key,row[key]]))).sort((a,b)=>a.member_id.localeCompare(b.member_id));}
export function seedImport(){
 seedRemaining();sql("update teachers set position='교사' where sort_order>=1900; truncate roster_snapshots restart identity; delete from alert_log where kind='명단엑셀';");
 const before=teacherState();
 const rows=before.slice(0,1800).map((row,index)=>({memberId:row.member_id,name:index===40?'가짜이름변경':row.name,dept:row.dept,region:index===40?'새지역':row.region,note:row.note,tier:'정교사',format:'activity',counsel:3,gospelRoom:2,companion:1,activeState:'정교사',monthStats:{month:'11월',edu:2,counsel:3,gospel:2,family:0,companion:1,task:1,lead:1,teach:0,serve:0,active:1,excellent:0,tierRaw:'정교사'}}));
 return {before,rows};
}
export function activitySheet(rows){
 const headers=['고유번호','이름','부서','지역','소속비고','교육','상담','복음방','식구복방','동행교사','과제제출','인도','교사','섬김','활동','우수,정','구분'];
 return [['가짜 교사활동현황'],headers,...rows.map(row=>[row.memberId,row.name,row.dept,row.region,row.note,2,3,2,0,1,1,1,0,0,1,0,row.tier])];
}
