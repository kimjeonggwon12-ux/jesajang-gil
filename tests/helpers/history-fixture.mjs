import {seedCoaching} from './coaching-fixture.mjs';
import {sql,ids} from './local-db.mjs';
export function seedFeedbackHistory(){
 seedCoaching();
 sql(`insert into feedbacks(receipt_no,member_id,name,source,situation,ai_coach_text,handler_answer,status,submitted_at) values
 ('SELF-1','${ids.member}','테스트교사','AI셀프코칭','첫 번째 가짜 셀프코칭','가짜 AI 답변','','완료','2026-11-12'),
 ('SELF-2','${ids.member}','테스트교사','AI셀프코칭','<img src=x onerror="window.historyInjected=true"> 가짜 상황','<script>window.historyInjected=true</script> 가짜 AI 답변','가짜 후속 답변','완료','2026-10-01');`);
}
