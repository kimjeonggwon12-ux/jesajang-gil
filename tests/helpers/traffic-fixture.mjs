import {seed,sql,ids} from './local-db.mjs';
export const chatId=[ids.member,ids.other].sort().join('__');
export function seedTraffic() {
  seed();
  sql(`truncate chat_messages,coop_requests,target_history,targets restart identity;
    insert into chat_messages(chat_id,from_id,to_id,message,sent_at,is_read)
    select '${chatId}','${ids.other}','${ids.member}','가짜 대화 '||g||' '||repeat('가짜 내용 ',12),'2026-11-12 09:00:00',g<=1200 from generate_series(1,1205)g;
    insert into targets(target_id,creator_id,target_name,stage) select 'TRAFFIC-'||g,'${ids.member}','가짜 대상 '||g,'섭외' from generate_series(1,10)g;
    insert into target_history(member_id,target_id,changed_at,from_stage,to_stage,memo)
    select '${ids.member}','TRAFFIC-'||((g%10)+1),'2026-11-12 09:00:00','섭외','친분',repeat('가짜 이력 ',50) from generate_series(1,1205)g;`);
}
export async function metrics(reset=false) {
  return (await fetch('http://127.0.0.1:58433/__local_metrics',{method:reset?'POST':'GET'})).json();
}
